import { nanoid } from "nanoid";
import {
  ProtocolParser,
  applyEvent,
  emptyBoard,
  type BoardState,
  type LessonEvent,
  type ServerMessage,
  type TurnState,
} from "@openstudy/shared";
import type { Brain } from "./brain";
import type { ImageBackend } from "./images";
import { intakeMessage, tutorSystemPrompt } from "./prompts";
import { log } from "./log";

/**
 * One lesson. Owns the transcript, the board state, the parser, and the
 * in-flight turn. Everything the model writes becomes events sent to the
 * client and applied to the server-side board copy.
 */
export class Session {
  readonly id = nanoid(10);
  board: BoardState = emptyBoard();
  state: TurnState = "idle";
  private abort: AbortController | null = null;
  private spoken: string[] = [];
  private queued: string | null = null;

  constructor(
    private readonly brain: Brain,
    private readonly images: ImageBackend,
    private readonly send: (m: ServerMessage) => void,
  ) {}

  async start(topic: string, materials: { name: string; text: string }[]) {
    this.board = emptyBoard(topic);
    this.send({ type: "session", id: this.id, brain: this.brain.name, model: this.brain.model });
    await this.runTurn(intakeMessage(topic, materials));
  }

  async user(text: string) {
    if (this.state === "thinking" || this.state === "speaking") {
      // Student spoke over the tutor: stop, remember what was heard, answer.
      this.queued = text;
      this.interrupt();
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

  private setState(s: TurnState, options?: string[]) {
    this.state = s;
    this.send(options ? { type: "turn", state: s, options } : { type: "turn", state: s });
  }

  private emit(e: LessonEvent) {
    this.board = applyEvent(this.board, e);
    this.send({ type: "event", event: e });
    if (e.type === "say") {
      this.spoken.push(e.text);
      if (this.state === "thinking") this.setState("speaking");
    }
    if (e.type === "block.add" && e.block.type === "image") this.generateImage(e.block.id, e.block.prompt);
  }

  private async generateImage(id: string, prompt: string) {
    try {
      const { url } = await this.images.generate({ id, prompt });
      const e: LessonEvent = { type: "image.update", id, status: "ready", url };
      this.board = applyEvent(this.board, e);
      this.send({ type: "event", event: e });
    } catch (err) {
      log.warn("image failed", id, err);
      const e: LessonEvent = { type: "image.update", id, status: "failed" };
      this.board = applyEvent(this.board, e);
      this.send({ type: "event", event: e });
    }
  }

  private async runTurn(userText: string) {
    this.abort = new AbortController();
    const { signal } = this.abort;
    this.spoken = [];
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
      system: tutorSystemPrompt(),
      userText,
      signal,
      onText: (t) => parser.feed(t),
    });
    parser.end();

    if (result.meta) this.send({ type: "debug", text: `turn: ${JSON.stringify(result.meta)}` });

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
