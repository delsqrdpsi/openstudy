import { nanoid } from "nanoid";
import {
  ProtocolParser,
  applyEvent,
  emptyBoard,
  type BoardState,
  type LessonEvent,
  type LessonPlan,
  type ServerMessage,
  type TurnState,
} from "@openstudy/shared";
import type { Brain } from "./brain";
import type { ImageBackend } from "./images";
import type { Store } from "./store";
import { LessonPlanSchema } from "@openstudy/shared";
import { intakeMessage, tutorSystemPrompt } from "./prompts";
import { planLesson, planForTutor } from "./planner";
import { figuresForPrompt, getFigure, listFigures } from "./figures";
import { startBuild } from "./figures/builder";
import { log } from "./log";

/** How long the first teaching turn waits for the planner before going without it. */
const PLAN_WAIT_MS = Number(process.env.PLAN_WAIT_MS ?? 4000);

/**
 * One lesson. Owns the transcript, the board state, the parser, the planner
 * hand-off and the in-flight turn. Everything the model writes becomes events
 * sent to the client and applied to the server-side board copy.
 */
export class Session {
  readonly id = nanoid(10);
  board: BoardState = emptyBoard();
  state: TurnState = "idle";
  private abort: AbortController | null = null;
  private spoken: string[] = [];
  /** Words said and written this turn, and diagrams drawn, so a thin board gets called out next turn. */
  private turnWords = { said: 0, wrote: 0, diagrams: 0 };
  private boardNudge: string | null = null;
  private queued: string | null = null;
  /** Blocks added this turn, tagged with how many @say lines preceded them. */
  private turnBlocks: { id: string; afterSay: number }[] = [];
  private heard: number | null = null;
  private turns = 0;
  private plan: Promise<LessonPlan | null> = Promise.resolve(null);
  private planDelivered = false;
  private latePlan: LessonPlan | null = null;
  /** Pictures generated ahead of time from the plan, by block id. */
  private readyImages = new Map<string, Promise<string>>();
  /** Set when reopening a saved board: what was said so far, in case the brain's own session is gone. */
  private resumeTranscript: string | null = null;
  private recovered = false;
  private buildsRequested = 0;
  /** Turns in a row the tutor kept going without asking anything. */
  private autoRun = 0;
  private awaitingContinue = false;
  private figureBase = process.env.TUTOR_PUBLIC_URL ?? `http://localhost:${process.env.TUTOR_PORT ?? 8787}`;

  constructor(
    private readonly brain: Brain,
    private readonly images: ImageBackend | null,
    private readonly store: Store,
    private readonly send: (m: ServerMessage) => void,
    id?: string,
  ) {
    if (id) this.id = id;
  }

  async start(topic: string, materials: { name: string; text: string }[]) {
    this.board = emptyBoard(topic);
    this.store.createBoard({ id: this.id, title: titleFrom(topic), topic, brain: this.brain.name, model: this.brain.model });
    this.send({ type: "session", id: this.id, brain: this.brain.name, model: this.brain.model, title: titleFrom(topic) });
    // Plan while the intake conversation happens; usually ready before the student answers.
    this.plan = planLesson({ topic, materials, imagesEnabled: !!this.images, figures: figuresForPrompt(listFigures()) })
      .then((plan) => {
        this.pregenerate(plan);
        this.store.setPlan(this.id, JSON.stringify(plan));
        this.store.setTitle(this.id, plan.title);
        this.send({ type: "debug", text: `plan: ${plan.title} (${plan.sections.length} sections)` });
        return plan;
      })
      .catch((err) => {
        log.warn("planner failed, tutor will plan on its own:", err instanceof Error ? err.message : err);
        this.send({ type: "debug", text: `planner failed: ${err instanceof Error ? err.message : err}` });
        return null;
      });
    await this.runTurn(intakeMessage(topic, materials));
  }

  /** Reopen a saved lesson: replay its log to the client and continue the brain's session. */
  async resume() {
    const row = this.store.getBoard(this.id);
    if (!row) throw new Error("no such board");
    const log = this.store.log(this.id);
    this.board = emptyBoard(row.topic);
    for (const e of log) if (e.kind === "event") this.board = applyEvent(this.board, e.event);
    this.send({ type: "session", id: this.id, brain: this.brain.name, model: this.brain.model, title: row.title });
    this.send({ type: "history", log });
    this.resumeTranscript = transcriptOf(log);
    this.planDelivered = true;
    if (row.planJson) {
      const parsed = LessonPlanSchema.safeParse(JSON.parse(row.planJson));
      if (parsed.success) this.plan = Promise.resolve(parsed.data);
    }
    this.setState("waiting");
    if (log.length > 0) {
      // Greet the returning student and recap, the way a tutor would when you walk back in.
      const lastSaid = [...log].reverse().find((e) => e.kind === "event" && e.event.type === "say");
      const heard = lastSaid && lastSaid.kind === "event" && lastSaid.event.type === "say" ? lastSaid.event.text : "";
      await this.runTurn(
        `[The student just came back to this board after a break. The last thing you said was: "${heard.slice(0, 200)}". Greet them, recap where the lesson was in one or two spoken lines, ask if they are ready to pick up, then @ask. Do not add new board blocks in this turn.]`,
      );
    }
  }

  async user(text: string) {
    this.awaitingContinue = false;
    this.autoRun = 0;
    this.store.append(this.id, { kind: "user", text });
    if (this.state === "thinking" || this.state === "speaking") {
      // Student spoke over the tutor: stop, remember what was heard, answer.
      this.queued = text;
      this.interrupt();
      return;
    }
    if (!this.planDelivered) {
      this.setState("thinking");
      // Give the planner a moment; if it is late, start teaching on a provisional
      // plan rather than asking the student another question to fill time.
      const quick = await Promise.race([this.plan, new Promise<null>((r) => setTimeout(() => r(null), PLAN_WAIT_MS))]);
      const plan = quick;
      if (plan) {
        this.planDelivered = true;
        await this.runTurn(`${planForTutor(plan)}\n\nThe student answered your intake questions: "${text}"\nAdapt the plan to that answer (skip or reorder sections if needed) before writing it.`);
        return;
      }
      // Still no plan: start anyway and hand the plan over on the next turn.
      await this.runTurn(`${text}\n\n[The planner is late. Write a short provisional plan block yourself (id=plan, col 0) and teach the first concept. A fuller plan may arrive next turn; merge it then.]`);
      this.plan.then((p) => {
        if (p && !this.planDelivered) this.latePlan = p;
      });
      return;
    }
    if (this.latePlan) {
      const p = this.latePlan;
      this.latePlan = null;
      this.planDelivered = true;
      await this.runTurn(`${planForTutor(p)}\n\n[Merge this with the provisional plan already on the board: re-send the plan block (id=plan) with the merged list, keep what you already taught, continue from where you are.]\n\nThe student says: "${text}"`);
      return;
    }
    await this.runTurn(text);
  }

  interrupt(heard?: number) {
    this.heard = heard ?? null;
    this.abort?.abort();
  }

  close() {
    this.abort?.abort();
    this.brain.close();
  }

  private pregenerate(plan: LessonPlan) {
    if (!this.images) return;
    for (const s of plan.sections) {
      for (const im of s.images) {
        const ready = this.images.generate({ id: im.id, prompt: im.prompt }).then((r) => r.url);
        // The failure is handled when the picture is placed; until then it must not be an unhandled rejection.
        ready.catch((err) => log.warn("image pregeneration failed", im.id, err instanceof Error ? err.message : err));
        this.readyImages.set(im.id, ready);
      }
    }
  }

  private setState(s: TurnState, options?: string[], auto = false) {
    this.state = s;
    const m: ServerMessage = { type: "turn", state: s };
    if (options) m.options = options;
    if (auto) m.auto = true;
    this.send(m);
  }

  /** The client reports the @continue narration has played: keep teaching. */
  async continue() {
    if (!this.awaitingContinue || this.state !== "waiting") return;
    this.awaitingContinue = false;
    this.autoRun += 1;
    const nudge = this.autoRun >= 4 ? " You have been talking for a while now; make the next step land with a real check question." : "";
    await this.runTurn(`[The student is listening. Carry on with the next step.${nudge}]`);
  }

  private emit(e: LessonEvent) {
    if (e.type === "block.add" && e.block.type === "image" && !this.images) return; // pictures are off
    this.board = applyEvent(this.board, e);
    this.store.appendEvent(this.id, e);
    this.send({ type: "event", event: e });
    if (e.type === "say") {
      this.spoken.push(e.text);
      if (this.state === "thinking") this.setState("speaking");
    }
    if (e.type === "block.add") this.turnBlocks.push({ id: e.block.id, afterSay: this.spoken.length });
    if (e.type === "say") this.turnWords.said += words(e.text);
    else if (e.type === "block.append") this.turnWords.wrote += words(e.html.replace(/<[^>]+>/g, " "));
    else if (e.type === "block.add" && e.block.type === "html") this.turnWords.wrote += words(e.block.html.replace(/<[^>]+>/g, " "));
    else if (e.type === "block.add" && e.block.type === "svg") this.turnWords.diagrams += 1;
    if (e.type === "block.add" && e.block.type === "image") this.resolveImage(e.block.id, e.block.prompt);
  }

  private async resolveImage(id: string, prompt: string) {
    const t0 = Date.now();
    try {
      const ready = this.readyImages.get(id);
      const url = ready ? await ready : (await this.images!.generate({ id, prompt })).url;
      log.info(`image ${id} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s${ready ? " (pregenerated)" : ""}`);
      this.update({ type: "image.update", id, status: "ready", url });
    } catch (err) {
      log.warn("image failed", id, err instanceof Error ? err.message : err);
      this.update({ type: "image.update", id, status: "failed" });
    }
  }

  private placeFigure(s: { id: string; column: number; name: string; caption?: string }) {
    const fig = getFigure(s.name);
    if (!fig) {
      this.send({ type: "debug", text: `no figure named ${s.name}` });
      return;
    }
    this.emit({
      type: "block.add",
      block: { id: s.id, type: "embed", column: s.column, src: `${this.figureBase}/figures/${fig.name}/`, title: fig.title, caption: s.caption, height: fig.height },
    });
  }

  private requestFigure(name: string, concept: string) {
    if (this.buildsRequested >= 1) return;
    this.buildsRequested += 1;
    const column = Math.max(0, ...this.board.blocks.map((b) => ("column" in b ? b.column : 0)));
    const noteId = `building_${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    this.emit({ type: "block.add", block: { id: noteId, type: "html", column, html: `<i>Building an interactive model: ${escapeHtml(concept)}. It will appear here when it is ready, usually in under an hour.</i>` } });
    const boardId = this.id;
    const store = this.store;
    startBuild({
      name,
      concept,
      onDone: (job) => {
        if (job.status === "done" && job.figure) {
          const block = { id: `model_${job.figure.name.replace(/-/g, "_")}`, type: "embed" as const, column, src: `${this.figureBase}/figures/${job.figure.name}/`, title: job.figure.title, caption: concept, height: job.figure.height };
          const add: LessonEvent = { type: "block.add", block };
          const remove: LessonEvent = { type: "block.remove", id: noteId };
          // The lesson may be over by now: always save, and send if still connected.
          store.appendEvent(boardId, remove);
          store.appendEvent(boardId, add);
          this.board = applyEvent(applyEvent(this.board, remove), add);
          this.send({ type: "event", event: remove });
          this.send({ type: "event", event: add });
        } else {
          const fail: LessonEvent = { type: "block.add", block: { id: noteId, type: "html", column, html: `<i>The model build did not finish: ${escapeHtml(job.error ?? "unknown error")}</i>` } };
          store.appendEvent(boardId, fail);
          this.send({ type: "event", event: fail });
        }
      },
    });
  }

  private update(e: LessonEvent) {
    this.board = applyEvent(this.board, e);
    this.store.appendEvent(this.id, e);
    this.send({ type: "event", event: e });
  }

  /**
   * The board should carry what was said. When a teaching turn speaks far
   * more than it writes, the next turn opens with the numbers so the model
   * corrects course, instead of drifting into a lecture with a bare board.
   */
  private checkBoardCoverage() {
    const { said, wrote, diagrams } = this.turnWords;
    if (said < 40 || !this.planDelivered) return; // intake and short replies are fine
    const thin = wrote < said * 0.6;
    if (!thin) return;
    log.info(`board thin on ${this.id}: said ${said}, wrote ${wrote}, diagrams ${diagrams}`);
    this.boardNudge = `[Board check on your last turn: you said ${said} words but wrote only ${wrote}${diagrams ? "" : ", and drew no diagram"}. The board must carry what you say. This turn, put each spoken point on the board as a line, step, formula or table row${diagrams ? "" : ", and draw an @svg diagram of the idea's structure"}.]`;
  }

  private async runTurn(userText: string) {
    this.abort = new AbortController();
    const { signal } = this.abort;
    this.spoken = [];
    this.turnBlocks = [];
    this.turnWords = { said: 0, wrote: 0, diagrams: 0 };
    this.heard = null;
    this.turns += 1;
    if (this.boardNudge) {
      userText = `${this.boardNudge}\n\n${userText}`;
      this.boardNudge = null;
    }
    this.setState("thinking");
    let ended: "ask" | "continue" | "done" | null = null;
    let options: string[] | undefined;
    const parser = new ProtocolParser({
      event: (e) => this.emit(e),
      signal: (s) => {
        if (s.type === "ask") {
          ended = "ask";
          options = s.options;
        } else if (s.type === "continue") ended = "continue";
        else if (s.type === "done") ended = "done";
        else if (s.type === "figure") this.placeFigure(s);
        else if (s.type === "build_figure") this.requestFigure(s.name, s.concept);
        else this.send({ type: "debug", text: `protocol: ${s.message} in "${s.line}"` });
      },
    });

    const result = await this.brain.turn({
      system: tutorSystemPrompt({ imagesEnabled: !!this.images, figures: figuresForPrompt(listFigures()) }),
      userText,
      signal,
      onText: (t) => parser.feed(t),
    });
    parser.end();
    if (this.brain.session) this.store.setBrainSession(this.id, this.brain.session);

    if (result.meta) this.send({ type: "debug", text: `turn ${this.turns}: ${JSON.stringify(result.meta)}` });

    if (result.status === "aborted") {
      // The client paces the board to speech, so anything after the last
      // line the student heard was never shown. Take it off the board.
      const heardCount = this.heard ?? this.spoken.length;
      const unseen = this.turnBlocks.filter((b) => b.afterSay > heardCount);
      for (const b of unseen) this.update({ type: "block.remove", id: b.id });
      const heard = this.spoken.slice(0, heardCount).join(" ");
      const next = this.queued;
      this.queued = null;
      this.setState("waiting");
      if (next) {
        await this.runTurn(
          `[The student interrupted you. They heard up to: "${heard.slice(-300)}". ${unseen.length ? "The blocks you wrote after that were removed from the board; re-add them later if they still matter." : "Keep what is on the board."} Answer them, then continue.]\n\n${next}`,
        );
      }
      return;
    }
    if (result.status === "error") {
      if (result.lostSession && this.resumeTranscript !== null && !this.recovered && this.brain.forget) {
        // The saved board outlived the CLI session. Start a fresh one, seeded with what was said.
        this.recovered = true;
        log.warn("brain session lost for board", this.id, "- starting a fresh one from the transcript");
        this.brain.forget();
        const plan = await this.plan;
        await this.runTurn(
          `[You are continuing a saved lesson. Everything below is already on the board and was already said; do not rewrite or repeat it. Pick up exactly where it stops.${
            plan ? `\n\nLesson plan: "${plan.title}": ${plan.sections.map((s, i) => `${i + 1}. ${s.title}`).join(" ")}` : ""
          }\n\nTranscript so far:\n${this.resumeTranscript}]\n\n${userText}`,
        );
        return;
      }
      log.warn("turn failed for board", this.id, result.message);
      this.send({ type: "error", message: result.message ?? "the tutor stopped unexpectedly" });
      this.setState("waiting");
      return;
    }
    this.checkBoardCoverage();
    if (ended === "continue") {
      this.awaitingContinue = true;
      this.setState("waiting", undefined, true);
      return;
    }
    this.autoRun = 0;
    this.setState(ended === "done" ? "done" : "waiting", options);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function titleFrom(topic: string): string {
  const t = topic.replace(/\s+/g, " ").trim();
  return t.length > 60 ? t.slice(0, 57).trimEnd() + "..." : t || "Untitled lesson";
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** The spoken side of a saved log as plain lines, most recent 6000 characters. */
function transcriptOf(log: ReturnType<Store["log"]>): string {
  const lines: string[] = [];
  for (const row of log) {
    if (row.kind === "user") lines.push(`Student: ${row.text}`);
    else if (row.event.type === "say") lines.push(`Tutor: ${row.event.text}`);
    else if (row.event.type === "section") lines.push(`[Section: ${row.event.title}]`);
  }
  const text = lines.join("\n");
  return text.length > 6000 ? "...\n" + text.slice(-6000) : text;
}
