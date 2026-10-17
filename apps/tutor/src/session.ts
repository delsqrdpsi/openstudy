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
import { intakeMessage, tutorSystemPrompt } from "./prompts";
import { planLesson, planForTutor } from "./planner";
import { log } from "./log";

/** How long the first teaching turn waits for the planner before going without it. */
const PLAN_WAIT_MS = Number(process.env.PLAN_WAIT_MS ?? 30000);

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
  private queued: string | null = null;
  private turns = 0;
  private plan: Promise<LessonPlan | null> = Promise.resolve(null);
  private planDelivered = false;
  private bridged = false;
  /** Pictures generated ahead of time from the plan, by block id. */
  private readyImages = new Map<string, Promise<string>>();

  constructor(
    private readonly brain: Brain,
    private readonly images: ImageBackend | null,
    private readonly send: (m: ServerMessage) => void,
  ) {}

  async start(topic: string, materials: { name: string; text: string }[]) {
    this.board = emptyBoard(topic);
    this.send({ type: "session", id: this.id, brain: this.brain.name, model: this.brain.model });
    // Plan while the intake conversation happens; usually ready before the student answers.
    this.plan = planLesson({ topic, materials, imagesEnabled: !!this.images })
      .then((plan) => {
        this.pregenerate(plan);
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

  async user(text: string) {
    if (this.state === "thinking" || this.state === "speaking") {
      // Student spoke over the tutor: stop, remember what was heard, answer.
      this.queued = text;
      this.interrupt();
      return;
    }
    if (!this.planDelivered) {
      this.setState("thinking");
      // If the plan is not ready yet, keep the conversation going with one
      // more probing question instead of a long silence.
      const quick = await Promise.race([this.plan, new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
      if (!quick && !this.bridged) {
        this.bridged = true;
        await this.runTurn(
          `${text}\n\n[The plan is still being prepared. Do not start teaching yet. React to what they said in one or two spoken lines, then ask ONE more specific question about their goal or background (something that changes how you would teach it), then @ask.]`,
        );
        return;
      }
      this.planDelivered = true;
      const plan = quick ?? (await Promise.race([this.plan, new Promise<null>((r) => setTimeout(() => r(null), PLAN_WAIT_MS))]));
      if (plan) {
        await this.runTurn(`${planForTutor(plan)}\n\nThe student answered your intake questions: "${text}"\nAdapt the plan to that answer (skip or reorder sections if needed) before writing it.`);
        return;
      }
      await this.runTurn(`${text}\n\n[No planner result. Write a short numbered plan block yourself (id=plan, col 0), then teach section 1.]`);
      return;
    }
    await this.runTurn(text);
  }

  interrupt() {
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
        this.readyImages.set(
          im.id,
          this.images.generate({ id: im.id, prompt: im.prompt }).then((r) => r.url),
        );
      }
    }
  }

  private setState(s: TurnState, options?: string[]) {
    this.state = s;
    this.send(options ? { type: "turn", state: s, options } : { type: "turn", state: s });
  }

  private emit(e: LessonEvent) {
    if (e.type === "block.add" && e.block.type === "image" && !this.images) return; // pictures are off
    this.board = applyEvent(this.board, e);
    this.send({ type: "event", event: e });
    if (e.type === "say") {
      this.spoken.push(e.text);
      if (this.state === "thinking") this.setState("speaking");
    }
    if (e.type === "block.add" && e.block.type === "image") this.resolveImage(e.block.id, e.block.prompt);
  }

  private async resolveImage(id: string, prompt: string) {
    try {
      const ready = this.readyImages.get(id);
      const url = ready ? await ready : (await this.images!.generate({ id, prompt })).url;
      this.update({ type: "image.update", id, status: "ready", url });
    } catch (err) {
      log.warn("image failed", id, err instanceof Error ? err.message : err);
      this.update({ type: "image.update", id, status: "failed" });
    }
  }

  private update(e: LessonEvent) {
    this.board = applyEvent(this.board, e);
    this.send({ type: "event", event: e });
  }

  private async runTurn(userText: string) {
    this.abort = new AbortController();
    const { signal } = this.abort;
    this.spoken = [];
    this.turns += 1;
    this.setState("thinking");
    let ended: "ask" | "done" | null = null;
    let options: string[] | undefined;
    const parser = new ProtocolParser({
      event: (e) => this.emit(e),
      signal: (s) => {
        if (s.type === "ask") {
          ended = "ask";
          options = s.options;
        } else if (s.type === "done") ended = "done";
        else this.send({ type: "debug", text: `protocol: ${s.message} in "${s.line}"` });
      },
    });

    const result = await this.brain.turn({
      system: tutorSystemPrompt({ imagesEnabled: !!this.images }),
      userText,
      signal,
      onText: (t) => parser.feed(t),
    });
    parser.end();

    if (result.meta) this.send({ type: "debug", text: `turn ${this.turns}: ${JSON.stringify(result.meta)}` });

    if (result.status === "aborted") {
      const heard = this.spoken.join(" ");
      const next = this.queued;
      this.queued = null;
      this.setState("waiting");
      if (next) {
        await this.runTurn(
          `[The student interrupted you. They heard up to: "${heard.slice(-300)}". Keep what is on the board. Answer them, then continue.]\n\n${next}`,
        );
      }
      return;
    }
    if (result.status === "error") {
      this.send({ type: "error", message: result.message ?? "the tutor stopped unexpectedly" });
      this.setState("waiting");
      return;
    }
    this.setState(ended === "done" ? "done" : "waiting", options);
  }
}
