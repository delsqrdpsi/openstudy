import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import os from "node:os";

// The fake tutor keeps its boards and what it received here, so a test can kill and restart it.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "openstudy-fake-tutor-"));
const RECV = path.join(DIR, "fake-recv.jsonl");
let fake: ChildProcess | null = null;

async function startFake() {
  fake = spawn("node", [path.join(__dirname, "fake-tutor.mjs")], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, FAKE_TUTOR_DIR: DIR } });
  await new Promise<void>((resolve) => fake!.stdout!.on("data", (d) => String(d).includes("fake tutor on") && resolve()));
}
function killFake() {
  fake?.kill("SIGKILL");
  fake = null;
}
const received = (): Record<string, unknown>[] => (fs.existsSync(RECV) ? fs.readFileSync(RECV, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const chat = (page: Page) => page.locator("aside .overflow-y-auto");

test.beforeEach(async () => {
  for (const f of ["fake-state.json", "fake-recv.jsonl"]) fs.rmSync(path.join(DIR, f), { force: true });
  await startFake();
});
test.afterEach(() => killFake());

async function openLesson(page: Page, topic: string) {
  await page.goto(`/live?topic=${encodeURIComponent(topic)}&model=sonnet`);
  // The board id is in the address bar before the server answers.
  await expect(page).toHaveURL(/board=[A-Za-z0-9_-]{21}/);
  // Headless Chromium counts as already activated, so no sound prompt here (see the last test).
  await page.getByRole("button", { name: "Mute tutor" }).click();
}

test("reconnects after a server restart, replaces history, sends what was typed meanwhile", async ({ page }) => {
  await openLesson(page, "fractions");
  const id = new URL(page.url()).searchParams.get("board");
  await expect(chat(page).getByText("Second line.", { exact: true })).toBeVisible({ timeout: 15000 });
  // Once the server has the board, the address is just the board.
  await expect(page).toHaveURL(new RegExp(`/live\\?board=${id}$`));
  const first = received().find((m) => m.type === "start")!;
  expect(first.id).toBe(id);

  killFake();
  await expect(page.getByText("Reconnecting to the tutor...")).toBeVisible({ timeout: 5000 });
  await page.getByLabel("Message the tutor").fill("typed while away");
  await page.getByLabel("Send").click();
  await expect(chat(page).getByText("typed while away")).toHaveCount(1);
  await page.waitForTimeout(2500);
  await startFake();

  await expect(page.getByText("Reconnecting to the tutor...")).toHaveCount(0, { timeout: 15000 });
  await expect.poll(() => received().filter((m) => m.type === "user").map((m) => m.text)).toEqual(["typed while away"]);
  const resume = received().filter((m) => m.type === "start").at(-1)!;
  expect(resume).toMatchObject({ resume: id, quiet: true });
  // History replaced the chat rather than appending a second copy.
  await expect(chat(page).getByText("Second line.", { exact: true })).toHaveCount(1);
  await expect(chat(page).getByText("Hello there.", { exact: true })).toHaveCount(1);
  await expect(chat(page).getByText("typed while away")).toHaveCount(1);
  // The answer to the queued message plays.
  await expect(chat(page).getByText(/Point 1 is here/)).toBeVisible({ timeout: 15000 });
});

test("Stop drops events still in flight and leaves 'teaching' at once", async ({ page }) => {
  await openLesson(page, "gating");
  await expect(chat(page).getByText("Second line.", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Message the tutor").fill("go on");
  await page.getByLabel("Send").click();
  await expect(chat(page).getByText(/Point 1 is here/)).toBeVisible({ timeout: 15000 });
  const stop = page.getByTitle("Stop the tutor");
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(page.locator("aside header")).toContainText("your turn");
  await expect.poll(() => received().some((m) => m.type === "interrupt")).toBe(true);
  await page.waitForTimeout(3000);
  await expect(page.getByText("LEAKED")).toHaveCount(0);
  await expect(page.locator('[data-item-id="leak"]')).toHaveCount(0);
  await expect(chat(page).getByText(/Point 6 is here/)).toHaveCount(0);
  // The next answer is not gated.
  await page.getByLabel("Message the tutor").fill("again");
  await page.getByLabel("Send").click();
  await expect(chat(page).getByText(/Point 1 is here/)).toHaveCount(2, { timeout: 15000 });
});

test("a @wait turn holds for the student; 'go on' continues it without a message to the tutor", async ({ page }) => {
  await openLesson(page, "waiting");
  await expect(chat(page).getByText("Second line.", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Message the tutor").fill("look");
  await page.getByLabel("Send").click();
  await expect(page.getByRole("button", { name: "Go on" })).toBeVisible({ timeout: 15000 });
  await expect(page.locator("aside header")).toContainText("take a look");
  await page.waitForTimeout(1500);
  expect(received().some((m) => m.type === "continue")).toBe(false);
  await page.getByLabel("Message the tutor").fill("ok go on");
  await page.getByLabel("Send").click();
  await expect.poll(() => received().some((m) => m.type === "continue")).toBe(true);
  expect(received().some((m) => m.type === "user" && m.text === "ok go on")).toBe(false);
  await expect(chat(page).getByText("Going on.", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Go on" })).toHaveCount(0);
});

test("typing 'wait' while the tutor talks pauses the lesson instead of cutting it", async ({ page }) => {
  await openLesson(page, "pausing");
  await expect(chat(page).getByText("Second line.", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Message the tutor").fill("go on");
  await page.getByLabel("Send").click();
  await expect(chat(page).getByText(/Point 1 is here/)).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Message the tutor").fill("wait");
  await page.getByLabel("Send").click();
  await expect(page.getByText(/^Paused\./)).toBeVisible();
  await expect.poll(() => received().some((m) => m.type === "pace")).toBe(true);
  expect(received().some((m) => m.type === "interrupt")).toBe(false);
  expect(received().some((m) => m.type === "user" && m.text === "wait")).toBe(false);
  // Nothing moves while paused.
  const before = await chat(page).innerText();
  await page.waitForTimeout(2500);
  expect(await chat(page).innerText()).toBe(before);
  await page.getByLabel("Message the tutor").fill("ok");
  await page.getByLabel("Send").click();
  await expect(page.getByText(/^Paused\./)).toHaveCount(0);
  // The rest of the turn plays on from where it was held.
  await expect(chat(page).getByText(/Point 6 is here/)).toBeVisible({ timeout: 45000 });
});

test("a long paste is clipped to what the server accepts", async ({ page }) => {
  await openLesson(page, "paste");
  await expect(chat(page).getByText("Second line.", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Message the tutor").fill("y".repeat(9000));
  await page.getByLabel("Send").click();
  await expect.poll(() => received().filter((m) => m.type === "user").map((m) => String(m.text).length)).toEqual([8000]);
});

test("the tutor's offer shows as a card and is answered", async ({ page }) => {
  await openLesson(page, "offers");
  await expect(chat(page).getByText("Second line.", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.request.get("http://127.0.0.1:9311/offer?id=o1");
  await page.request.get("http://127.0.0.1:9311/offer?id=o2"); // replaces the first
  const card = page.getByRole("region", { name: "Offer from the tutor" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("A <b>pendulum</b> you can swing"); // verbatim, not as html
  await expect(card).toContainText("Takes up to an hour.");
  await card.getByRole("button", { name: "Build it" }).focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveCount(0);
  await expect.poll(() => received().filter((m) => m.type === "offer.answer")).toEqual([expect.objectContaining({ id: "o2", accept: true })]);
});

test("a second tab takes the lesson over; the first one stops", async ({ page, context }) => {
  await openLesson(page, "two tabs");
  await expect(chat(page).getByText("Second line.", { exact: true })).toBeVisible({ timeout: 15000 });
  const url = page.url();
  const other = await context.newPage();
  await other.goto(url);
  await expect(chat(other).getByText("Second line.", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("This lesson is open in another tab.")).toBeVisible();
  const conns = Number(await (await page.request.get("http://127.0.0.1:9311/conns")).text());
  await page.waitForTimeout(5000);
  const after = Number(await (await page.request.get("http://127.0.0.1:9311/conns")).text());
  expect(after).toBe(conns); // the old tab did not reconnect
  // The new tab carries on.
  await other.getByRole("button", { name: "Mute tutor" }).click();
  await other.getByLabel("Message the tutor").fill("from the new tab");
  await other.getByLabel("Send").click();
  await expect(chat(other).getByText(/Point 1 is here/)).toBeVisible({ timeout: 15000 });
  await expect(chat(page).getByText(/Point 1 is here/)).toHaveCount(0);
});

test("reload before the server answers reopens the same board id", async ({ page }) => {
  await page.goto(`/live?topic=${encodeURIComponent("slow topic")}`);
  await expect(page).toHaveURL(/board=[A-Za-z0-9_-]{21}/);
  const id = new URL(page.url()).searchParams.get("board");
  await expect.poll(() => received().filter((m) => m.type === "start").length).toBe(1);
  await page.reload();
  await expect.poll(() => received().filter((m) => m.type === "start").length).toBe(2);
  const starts = received().filter((m) => m.type === "start");
  expect(starts.map((s) => s.id)).toEqual([id, id]);
  expect(starts[1].topic).toBe("slow topic");
  expect(new URL(page.url()).searchParams.get("board")).toBe(id);
});

test("a reloaded page holds the lesson until a click lets sound play", async ({ page }) => {
  // Headless Chromium reports an activation that a real reload would not have; pretend it has none.
  await page.addInitScript(() => Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: false, isActive: true } }));
  await page.goto(`/live?topic=${encodeURIComponent("sound gate")}`);
  const prompt = page.getByRole("button", { name: "Click to start sound" });
  await expect(prompt).toBeVisible();
  await expect.poll(() => received().filter((m) => m.type === "start").length).toBe(1);
  await page.waitForTimeout(1500);
  // The tutor's lines arrived but nothing landed yet.
  await expect(chat(page).getByText(/Hello there/)).toHaveCount(0);
  await prompt.click();
  await expect(prompt).toHaveCount(0);
  await expect(chat(page).getByText(/Hello there\./)).toBeVisible({ timeout: 15000 });
});

test("Space presses a focused toolbar button", async ({ page }) => {
  await page.goto("/lesson/rl101?autoplay=0");
  const follow = page.getByRole("button", { name: "Follow" });
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await follow.focus();
  await page.keyboard.press("Space");
  await expect(follow).toHaveAttribute("aria-pressed", "false");
});

test("chat stays where the student scrolled during playback", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 400 });
  await page.goto("/lesson/rl101");
  await page.getByLabel("Playback speed").selectOption("4");
  const list = page.locator("aside .overflow-y-auto");
  await expect.poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight + 200), { timeout: 30000 }).toBe(true);
  await list.hover();
  await page.mouse.wheel(0, -5000);
  await page.waitForTimeout(3000);
  expect(await list.evaluate((el) => el.scrollTop)).toBeLessThan(20);
  // Back at the bottom, it follows again.
  await page.mouse.wheel(0, 100000);
  await page.waitForTimeout(4000);
  expect(await list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(80);
});
