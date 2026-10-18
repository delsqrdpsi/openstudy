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
import { createBrain, type Brain, type TurnResult } from "./brain";
import type { ImageBackend } from "./images";
import type { Store } from "./store";
import { LessonEventSchema, LessonPlanSchema } from "@openstudy/shared";
import { intakeMessage, tutorSystemPrompt } from "./prompts";
import { planLesson, planForTutor } from "./planner";
import { getFigure } from "./figures";
import { pageBlockFor, sourcesAsMaterials, sourcesForPrompt } from "./sources";
import { startBuild, anatomyInstalled } from "./figures/builder";
import { log } from "./log";
import { UsageMeter, activeMeter, setActiveMeter, type TurnUsage } from "./usage";
import { UsageSchema } from "@openstudy/shared";

/** How long the first teaching turn waits for the planner before going without it. */
const PLAN_WAIT_MS = Number(process.env.PLAN_WAIT_MS ?? 4000);

/** An event of the current turn, tagged with how many @say lines came before it (-1: not from the model). */
interface TurnEvent {
  e: LessonEvent;
  afterSay: number;
}

/**
 * One lesson. Owns the transcript, the board state, the parser, the planner
 * hand-off and the in-flight turn. Everything the model writes becomes events
 * sent to the client and applied to the server-side board copy.
 *
 * Only one Session per board is live at a time (Session.live). Opening the
 * board somewhere else supersedes this one, which then stops talking.
 */
export class Session {
  /** The live session of each open board, so late results (a built model) reach the right place. */
  static readonly live = new Map<string, Session>();

  readonly id: string;
  board: BoardState = emptyBoard();
  state: TurnState = "idle";
  private closed = false;
  private abort: AbortController | null = null;
  /** A brain turn is in flight (spawned or about to be). */
  private turnRunning = false;
  /** Waiting for the planner before the first teaching turn. */
  private planWaiting = false;
  /** The student stopped the tutor while it was waiting for the planner. */
  private cancelPending = false;
  private spoken: string[] = [];
  /** Words said and written this turn, and diagrams drawn, so a thin board gets called out next turn. */
  private turnWords = { said: 0, wrote: 0, diagrams: 0 };
  private boardNudge: string | null = null;
  /** What the student said while the tutor could not take it yet; answered next. */
  private queued: string | null = null;
  /** The board when the current (or last) turn began, and what happened to it since. */
  private turnStart: BoardState = emptyBoard();
  private turnEvents: TurnEvent[] = [];
  private heard: number | null = null;
  /** Told to the model at the start of the next turn after an interruption. */
  private interruptNote: string | null = null;
  private turns = 0;
  private plan: Promise<LessonPlan | null> = Promise.resolve(null);
  private readonly planAbort = new AbortController();
  private planDelivered = false;
  /** The tutor started on its own provisional plan; the planner's plan is merged when it lands. */
  private provisional = false;
  private latePlan: LessonPlan | null = null;
  /** Pictures generated ahead of time from the plan, by block id. */
  private readyImages = new Map<string, Promise<string>>();
  /** The first message of the lesson, re-sent if the brain never got to answer it. */
  private intakeText: string | null = null;
  /** Something was already taught on this board (said or drawn), so a fresh brain session must be told. */
  private hasHistory = false;
  private buildsRequested = 0;
  private offer: { id: string; name: string; concept: string } | null = null;
  /** Turns in a row the tutor kept going without asking anything. */
  private autoRun = 0;
  private awaitingContinue = false;
  private pendingModel: string | null = null;
  readonly meter = new UsageMeter();
  private sources: string[] = [];
  private figureBase = process.env.TUTOR_PUBLIC_URL ?? `http://localhost:${process.env.TUTOR_PORT ?? 8787}`;
  private readonly out: (m: ServerMessage) => void;

  constructor(
    private brain: Brain,
    private readonly images: ImageBackend | null,
    private readonly store: Store,
    send: (m: ServerMessage) => void,
    id?: string,
  ) {
    this.id = id ?? nanoid(10);
    // A closed or superseded session never writes to its socket again.
    this.out = (m) => {
      if (!this.closed) send(m);
    };
  }

  /** Become the live session of this board; an older one (another tab) is told and stops. */
  private register() {
    const prev = Session.live.get(this.id);
    if (prev && prev !== this) prev.supersede();
    Session.live.set(this.id, this);
  }

  /** Another tab or window opened this board and owns the lesson now. */
  supersede() {
    this.out({ type: "error", code: "superseded", message: "This lesson is open in another tab or window." });
    this.close();
  }

  async start(topic: string, materials: { name: string; text: string }[], sources: string[] = []) {
    this.register();
    this.board = emptyBoard(topic);
    this.sources = sources;
    this.store.createBoard({ id: this.id, title: titleFrom(topic), topic, brain: this.brain.name, model: this.brain.model });
    if (sources.length) this.store.setSources(this.id, sources);
    this.attachMeter();
    materials = [...materials, ...sourcesAsMaterials(sources)];
    this.out({ type: "session", id: this.id, brain: this.brain.name, model: this.brain.model, title: titleFrom(topic) });
    // Plan while the intake conversation happens; usually ready before the student answers.
    this.startPlanner(topic, materials);
    this.intakeText = intakeMessage(topic, materials);
    await this.runTurn(this.intakeText);
  }

  private startPlanner(topic: string, materials: { name: string; text: string }[], intake?: { role: "tutor" | "student"; text: string }[]) {
    this.plan = planLesson({ topic, materials, intake, imagesEnabled: !!this.images, signal: this.planAbort.signal })
      .then(({ plan, costUsd }) => {
        if (this.closed) return plan;
        this.meter.plan(costUsd);
        this.pregenerate(plan);
        this.store.setPlan(this.id, JSON.stringify(plan));
        this.store.setTitle(this.id, plan.title);
        this.out({ type: "debug", text: `plan: ${plan.title} (${plan.sections.length} sections)` });
        return plan;
      })
      .catch((err) => {
        if (!this.closed) {
          log.warn("planner failed, tutor will plan on its own:", err instanceof Error ? err.message : err);
          this.out({ type: "debug", text: `planner failed: ${err instanceof Error ? err.message : err}` });
        }
        return null;
      });
  }

  /**
   * Reopen a saved lesson: replay its log to the client and continue the
   * brain's session. quiet: the client is reconnecting after a dropped
   * connection, so skip the welcome-back turn.
   */
  async resume(opts: { quiet?: boolean } = {}) {
    const row = this.store.getBoard(this.id);
    if (!row) throw new Error("no such board");
    this.register();
    const log = this.store.log(this.id);
    this.board = emptyBoard(row.topic);
    for (const e of log) if (e.kind === "event") this.board = applyEvent(this.board, e.event);
    this.turnStart = this.board;
    this.sources = this.store.getSources(this.id);
    const savedUsage = this.store.getUsage(this.id);
    if (savedUsage) {
      try {
        const parsed = UsageSchema.safeParse(JSON.parse(savedUsage));
        if (parsed.success) this.meter.usage = parsed.data;
      } catch {
        // a damaged usage row only loses the running totals
      }
    }
    this.attachMeter();
    this.out({ type: "session", id: this.id, brain: this.brain.name, model: this.brain.model, title: row.title });
    this.out({ type: "history", log });
    this.out({ type: "usage", usage: this.meter.usage });
    this.hasHistory = log.some((e) => e.kind === "event" && (e.event.type === "say" || e.event.type === "block.add"));
    const saved = row.planJson ? safePlan(row.planJson) : null;
    if (saved) {
      this.plan = Promise.resolve(saved);
      this.planDelivered = true;
    } else if (log.some((e) => e.kind === "event" && (e.event.type === "section" || (e.event.type === "block.add" && e.event.block.id === "plan")))) {
      // No planner plan was saved, but the tutor is past the intake on its own plan.
      this.planDelivered = true;
    } else {
      // Saved during the intake: plan now, from the topic, the sources and what was said so far.
      this.startPlanner(row.topic, sourcesAsMaterials(this.sources), intakeOf(log));
    }
    this.setState("waiting");
    if (opts.quiet || log.length === 0) return;
    // Greet the returning student and recap, the way a tutor would when you walk back in.
    const lastSaid = [...log].reverse().find((e) => e.kind === "event" && e.event.type === "say");
    const heard = lastSaid && lastSaid.kind === "event" && lastSaid.event.type === "say" ? lastSaid.event.text : "";
    await this.runTurn(
      `[The student just came back to this board after a break. The last thing you said was: "${heard.slice(0, 200)}". Greet them, recap where the lesson was in one or two spoken lines, ask if they are ready to pick up, then @ask. Do not add new board blocks in this turn.]`,
    );
  }

  async user(text: string) {
    if (this.closed) return;
    this.awaitingContinue = false;
    this.autoRun = 0;
    this.store.append(this.id, { kind: "user", text });
    if (this.turnRunning) {
      // Student spoke over the tutor: stop, keep what they heard, answer when the turn has wound down.
      this.queue(text);
      this.abort?.abort();
      return;
    }
    if (this.planWaiting) {
      // The first teaching turn is about to start; fold this in.
      this.queue(text);
      this.cancelPending = false;
      return;
    }
    await this.respond(text);
  }

  private queue(text: string) {
    this.queued = this.queued ? `${this.queued}\n${text}` : text;
  }

  private takeQueued(): string | null {
    const q = this.queued;
    this.queued = null;
    return q;
  }

  /** Answer the student: the first answer hands over the plan; later ones just continue. */
  private async respond(text: string) {
    if (this.planDelivered) return this.runTurn(this.withLatePlan(text));
    this.planWaiting = true;
    this.cancelPending = false;
    this.setState("thinking");
    // Give the planner a moment; if it is late, start teaching on a provisional
    // plan rather than asking the student another question to fill time.
    const plan = await Promise.race([this.plan, new Promise<null>((r) => setTimeout(() => r(null), PLAN_WAIT_MS))]);
    this.planWaiting = false;
    if (this.closed) return;
    const more = this.takeQueued();
    if (more) text = `${text}\n${more}`;
    if (this.cancelPending) {
      // Stopped while waiting: keep the answer for when they go on.
      this.cancelPending = false;
      this.queued = text;
      return;
    }
    this.planDelivered = true;
    if (plan) {
      await this.runTurn(`${planForTutor(plan)}\n\nThe student answered your intake questions: "${text}"\nAdapt the plan to that answer (skip or reorder sections if needed) before writing it.`);
      return;
    }
    // Still no plan: start on a provisional one; the planner's plan is merged when it lands.
    this.provisional = true;
    this.plan.then((p) => {
      if (p && this.provisional && !this.closed) this.latePlan = p;
    });
    await this.runTurn(`${text}\n\n[The planner is late. Write a short provisional plan block yourself (id=plan, col 0) and teach the first concept. A fuller plan may arrive later; merge it then.]`);
  }

  /** Hand over a plan that arrived after the tutor started on its own, once. */
  private withLatePlan(text: string): string {
    if (!this.latePlan) return text;
    const p = this.latePlan;
    this.latePlan = null;
    this.provisional = false;
    return `${planForTutor(p)}\n\n[Merge this with the provisional plan already on the board: re-send the plan block (id=plan) with the merged list, keep what you already taught, continue from where you are.]\n\n${text}`;
  }

  /**
   * The student stopped the tutor. heard: how many @say lines of the current
   * (or last) turn they actually heard. Always answered with the board put
   * back to what they saw, then exactly one turn message.
   */
  interrupt(heard?: number) {
    if (this.closed) return;
    if (heard !== undefined) this.heard = heard;
    this.awaitingContinue = false;
    if (this.turnRunning) {
      this.abort?.abort(); // runTurn's aborted path rolls back and reports the turn state
      return;
    }
    if (this.planWaiting) {
      this.cancelPending = true;
      this.setState("waiting");
      return;
    }
    // The model had already finished writing; the client was still speaking it.
    this.rollback(this.heard);
    this.heard = null;
    this.setState(this.state === "done" ? "done" : "waiting");
  }

  /**
   * Put the board back to what the student saw: everything from the current
   * turn up to the last line they heard, plus anything that arrived from
   * outside the turn (pictures finishing). A block the model re-sent after that
   * point gets its earlier version back instead of disappearing.
   */
  private rollback(heard: number | null) {
    const h = heard ?? this.spoken.length;
    let desired = this.turnStart;
    for (const te of this.turnEvents) if (te.afterSay < 0 || te.afterSay <= h) desired = applyEvent(desired, te.e);
    const want = new Map(desired.blocks.map((b) => [b.id, b]));
    const have = new Map(this.board.blocks.map((b) => [b.id, b]));
    let changed = 0;
    for (const id of have.keys()) {
      if (!want.has(id) && this.board.blocks.some((b) => b.id === id)) {
        this.update({ type: "block.remove", id });
        changed += 1;
      }
    }
    for (const b of desired.blocks) {
      const cur = this.board.blocks.find((x) => x.id === b.id);
      if (!cur || JSON.stringify(cur) !== JSON.stringify(b)) {
        this.update({ type: "block.add", block: b });
        changed += 1;
      }
    }
    const said = this.spoken.slice(0, h).join(" ");
    // The model is always told it was cut off, and where, so it does not carry on as if it had finished.
    this.interruptNote = `[The student interrupted you. ${said ? `They heard up to: "${said.slice(-300)}".` : "They heard nothing of your last turn."} ${
      changed ? "What you wrote after that was taken off the board; re-add it later if it still matters." : "Keep what is on the board."
    }]`;
  }

  /** The student answered a pending offer (building an interactive model). */
  answerOffer(id: string, accept: boolean) {
    const o = this.offer;
    if (!o || o.id !== id || this.closed) return;
    this.offer = null;
    if (accept) this.startFigureBuild(o.name, o.concept);
    else this.interruptNote = `[The student said no to building the interactive model of ${o.concept}. Do not offer it again this lesson.]`;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.abort?.abort();
    this.planAbort.abort();
    this.brain.close();
    if (Session.live.get(this.id) === this) Session.live.delete(this.id);
    if (activeMeter() === this.meter) setActiveMeter(null);
  }

  private attachMeter() {
    setActiveMeter(this.meter);
    this.meter.onChange((u) => {
      if (this.closed) return;
      this.store.setUsage(this.id, JSON.stringify(u));
      this.out({ type: "usage", usage: u });
    });
  }

  private pregenerate(plan: LessonPlan) {
    const images = this.images;
    if (!images) return;
    for (const s of plan.sections) {
      for (const im of s.images) {
        const ready = images.generate({ id: im.id, prompt: im.prompt }).then((r) => {
          this.meter.image(images.priceKey, images.name);
          return r.url;
        });
        // The failure is handled when the picture is placed; until then it must not be an unhandled rejection.
        ready.catch((err) => log.warn("image pregeneration failed", im.id, err instanceof Error ? err.message : err));
        this.readyImages.set(im.id, ready);
      }
    }
  }

  private setState(s: TurnState, options?: string[], auto = false) {
    if (s === "thinking" && this.state === "thinking") return; // already said so
    this.state = s;
    const m: ServerMessage = { type: "turn", state: s };
    if (options) m.options = options;
    if (auto) m.auto = true;
    this.out(m);
  }

  /** Change the model. Same conversation: the next turn resumes the brain's session on the new model. */
  setModel(model: string) {
    if (this.closed || model === this.brain.model) return;
    if (this.turnRunning) {
      this.pendingModel = model;
      return;
    }
    this.applyModel(model);
  }

  private applyModel(model: string) {
    this.pendingModel = null;
    const session = this.brain.session;
    this.brain.close();
    this.brain = createBrain({ model, session });
    this.store.setModel(this.id, model);
    this.out({ type: "session", id: this.id, brain: this.brain.name, model: this.brain.model, title: this.board.title });
    this.out({ type: "debug", text: `model switched to ${model}` });
  }

  /** The client reports the @continue narration has played: keep teaching. */
  async continue() {
    if (this.closed || !this.awaitingContinue || this.state !== "waiting" || this.turnRunning) return;
    this.awaitingContinue = false;
    this.autoRun += 1;
    const nudge = this.autoRun >= 4 ? " You have been talking for a while now; make the next step land with a real check question." : "";
    await this.runTurn(this.withLatePlan(`[The student is listening. Carry on with the next step.${nudge}]`));
  }

  private emit(e: LessonEvent) {
    if (this.closed) return;
    if (e.type === "block.add" && e.block.type === "image" && !this.images) return; // pictures are off
    // Never store an event the client would reject: one bad id would blank the saved board on reload.
    const ok = LessonEventSchema.safeParse(e);
    if (!ok.success) {
      this.out({ type: "debug", text: `dropped invalid ${e.type}: ${ok.error.issues[0]?.message ?? "invalid"}` });
      return;
    }
    this.board = applyEvent(this.board, e);
    this.turnEvents.push({ e, afterSay: this.spoken.length });
    this.store.appendEvent(this.id, e);
    this.out({ type: "event", event: e });
    if (e.type === "say") {
      this.spoken.push(e.text);
      if (this.state === "thinking") this.setState("speaking");
    }
    if (e.type === "say") this.turnWords.said += words(e.text);
    else if (e.type === "block.append") this.turnWords.wrote += words(e.html.replace(/<[^>]+>/g, " "));
    else if (e.type === "block.add" && e.block.type === "html") this.turnWords.wrote += words(e.block.html.replace(/<[^>]+>/g, " "));
    else if (e.type === "block.add" && e.block.type === "svg") this.turnWords.diagrams += 1;
    if (e.type === "block.add" && e.block.type === "image") void this.resolveImage(e.block.id, e.block.prompt);
  }

  private async resolveImage(id: string, prompt: string) {
    const t0 = Date.now();
    const images = this.images!;
    try {
      const ready = this.readyImages.get(id);
      let url: string;
      if (ready) url = await ready;
      else {
        url = (await images.generate({ id, prompt })).url;
        this.meter.image(images.priceKey, images.name);
      }
      log.info(`image ${id} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s${ready ? " (pregenerated)" : ""}`);
      this.update({ type: "image.update", id, status: "ready", url });
    } catch (err) {
      log.warn("image failed", id, err instanceof Error ? err.message : err);
      this.update({ type: "image.update", id, status: "failed" });
    }
  }

  /** Models built for this lesson; the shared library is never placed on its own. */
  private builtFigures = new Set<string>();

  private placeFigure(s: { id: string; column: number; name: string; caption?: string }) {
    const fig = this.builtFigures.has(s.name) ? getFigure(s.name) : null;
    if (!fig) {
      this.out({ type: "debug", text: `figure ${s.name} was not built for this lesson; not placed` });
      return;
    }
    this.emit({
      type: "block.add",
      block: { id: s.id, type: "embed", column: s.column, src: `${this.figureBase}/figures/${fig.name}/`, title: fig.title, caption: s.caption, height: fig.height },
    });
  }

  private placePage(s: { id: string; column: number; source: string; page: number; caption?: string }) {
    const p = pageBlockFor(this.sources, s.source, s.page, this.figureBase);
    if (!p) {
      this.out({ type: "debug", text: `no page ${s.page} in source ${s.source}` });
      return;
    }
    this.emit({ type: "block.add", block: { id: s.id, type: "page", column: s.column, src: p.src, source: p.source, page: p.page, aspect: p.aspect, boxes: p.boxes, caption: s.caption } });
  }

  /**
   * The tutor wants a new interactive model. Building one runs a coding agent
   * on this machine for up to an hour, and the request comes from model output
   * that may have read the student's documents, so the student decides: the
   * request becomes an offer, shown with its exact text.
   */
  private requestFigure(name: string, concept: string) {
    if (this.buildsRequested >= 1 || this.offer) return;
    if (!anatomyInstalled()) {
      log.warn("model build requested but the Anatomy skill is not installed (npx skills add wheresryan22/anatomy -g -a claude-code)");
      return;
    }
    const clean = cleanConcept(concept);
    if (!clean) return;
    this.offer = { id: nanoid(8), name, concept: clean };
    this.out({
      type: "offer",
      id: this.offer.id,
      kind: "build_figure",
      concept: clean,
      detail: `Build an interactive model of this? It runs in the background for up to an hour and uses up to $${process.env.FIGURE_BUDGET_USD ?? "6"} of your Claude plan.`,
    });
  }

  private startFigureBuild(name: string, concept: string) {
    if (this.buildsRequested >= 1) return;
    this.buildsRequested += 1;
    const column = Math.max(0, ...this.board.blocks.map((b) => ("column" in b ? b.column : 0)));
    const noteId = `building_${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`.slice(0, 64);
    this.update({ type: "block.add", block: { id: noteId, type: "html", column, html: `<i>Building an interactive model: ${escapeHtml(concept)}. It will appear here when it is ready, usually in under an hour.</i>` } });
    const boardId = this.id;
    const store = this.store;
    const figureBase = this.figureBase;
    startBuild({
      name,
      concept,
      onDone: (job) => {
        const events: LessonEvent[] =
          job.status === "done" && job.figure
            ? [
                { type: "block.remove", id: noteId },
                { type: "block.add", block: { id: `model_${job.figure.name.replace(/-/g, "_")}`.slice(0, 64), type: "embed", column, src: `${figureBase}/figures/${job.figure.name}/`, title: job.figure.title, caption: concept, height: job.figure.height } },
              ]
            : [{ type: "block.add", block: { id: noteId, type: "html", column, html: `<i>The model build did not finish: ${escapeHtml(job.error ?? "unknown error")}</i>` } }];
        // The lesson may have been closed or reopened in another tab by now: deliver to whoever has the board.
        const live = Session.live.get(boardId);
        if (job.status === "done" && job.figure) live?.builtFigures.add(job.figure.name);
        for (const e of events) {
          if (live) live.update(e);
          else store.appendEvent(boardId, e);
        }
      },
    });
  }

  private update(e: LessonEvent) {
    this.board = applyEvent(this.board, e);
    this.turnEvents.push({ e, afterSay: -1 });
    this.store.appendEvent(this.id, e);
    this.out({ type: "event", event: e });
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

  /**
   * What a brand-new brain session needs to carry on: used when the brain's own
   * conversation is gone (deleted, expired, never saved, or a different
   * machine). Built from the saved log, so nothing the student saw is lost.
   */
  private async seedFor(): Promise<string | null> {
    if (this.brain.session) return null;
    if (!this.hasHistory) return this.turns > 1 && this.intakeText ? `[Context: the start of this lesson, which you have not answered yet.]\n${this.intakeText}` : null;
    const row = this.store.getBoard(this.id);
    const plan = await Promise.race([this.plan, Promise.resolve(null)]);
    return [
      `[You are continuing a lesson that is already under way. Your earlier conversation with this student is not in your memory, so here is what happened. All of it is already on the board and was already said: do not repeat or rewrite it. Pick up exactly where it stops.`,
      row ? `Topic: ${row.topic}` : "",
      plan ? `Lesson plan "${plan.title}": ${plan.sections.map((s, i) => `${i + 1}. ${s.title}`).join(" ")}` : "",
      `Board now (block ids you can annotate, focus or update):\n${boardSummary(this.board)}`,
      `Transcript so far:\n${transcriptOf(this.store.log(this.id))}]`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private async runTurn(userText: string, opts: { recovery?: boolean } = {}): Promise<void> {
    if (this.closed) return;
    this.turnRunning = true;
    if (this.pendingModel) this.applyModel(this.pendingModel);
    this.abort = new AbortController();
    const { signal } = this.abort;
    this.spoken = [];
    this.turnStart = this.board;
    this.turnEvents = [];
    this.turnWords = { said: 0, wrote: 0, diagrams: 0 };
    this.heard = null;
    this.turns += 1;
    let prompt = userText;
    if (this.boardNudge) {
      prompt = `${this.boardNudge}\n\n${prompt}`;
      this.boardNudge = null;
    }
    if (this.interruptNote) {
      prompt = `${this.interruptNote}\n\n${prompt}`;
      this.interruptNote = null;
    }
    this.setState("thinking");
    let ended: "ask" | "continue" | "done" | null = null;
    let options: string[] | undefined;
    const parser = new ProtocolParser(
      {
        event: (e) => this.emit(e),
        signal: (s) => {
          if (s.type === "ask") {
            ended = "ask";
            options = s.options;
          } else if (s.type === "continue") ended = "continue";
          else if (s.type === "done") ended = "done";
          else if (s.type === "figure") this.placeFigure(s);
          else if (s.type === "page") this.placePage(s);
          else if (s.type === "build_figure") this.requestFigure(s.name, s.concept);
          else this.out({ type: "debug", text: `protocol: ${s.message} in "${s.line}"` });
        },
      },
      { existingIds: this.board.blocks.map((b) => b.id) },
    );

    let result: TurnResult;
    try {
      const seed = await this.seedFor();
      if (seed) prompt = `${seed}\n\n${prompt}`;
      result = await this.brain.turn({
        system: tutorSystemPrompt({ imagesEnabled: !!this.images, builds: anatomyInstalled(), sources: sourcesForPrompt(this.sources) }),
        userText: prompt,
        signal,
        onText: (t) => parser.feed(t),
      });
    } catch (err) {
      // Whatever went wrong, the turn must end: a lesson stuck on "thinking" is the worst outcome.
      result = { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
    this.turnRunning = false;
    if (this.closed) return;
    // A cut-off turn would end on a half-written diagram; only a finished one is flushed.
    if (result.status !== "aborted") parser.end();
    if (this.brain.session) this.store.setBrainSession(this.id, this.brain.session);
    if (result.meta) this.meter.turn(result.meta as TurnUsage);
    if (result.meta) this.out({ type: "debug", text: `turn ${this.turns}: ${JSON.stringify(result.meta)}` });
    if (this.spoken.length || this.turnEvents.length) this.hasHistory = true;

    if (result.status === "aborted") {
      // The client paces the board to speech, so anything after the last line
      // the student heard was never shown. Put the board back to what they saw.
      this.rollback(this.heard);
      this.heard = null;
      const next = this.takeQueued();
      this.setState("waiting");
      if (next) await this.runTurn(this.withLatePlan(next));
      return;
    }
    if (result.status === "error") {
      if (result.lostSession && !opts.recovery) {
        // The brain's conversation is gone. Start a fresh one, seeded from the saved board and transcript.
        log.warn("brain session lost for board", this.id, "- starting a fresh one from the saved lesson");
        this.out({ type: "debug", text: "brain session lost; continuing in a fresh one from the saved lesson" });
        this.brain.forget?.();
        await this.runTurn(userText, { recovery: true });
        return;
      }
      log.warn("turn failed for board", this.id, result.message);
      this.out({ type: "error", message: result.message ?? "the tutor stopped unexpectedly" });
      this.setState("waiting");
      const next = this.takeQueued();
      if (next) await this.runTurn(this.withLatePlan(next));
      return;
    }
    if (this.pendingModel) this.applyModel(this.pendingModel);
    this.checkBoardCoverage();
    const next = this.takeQueued();
    if (next) {
      // The student spoke just as the turn finished: answer that rather than carry on.
      this.setState("waiting");
      await this.runTurn(this.withLatePlan(next));
      return;
    }
    if (ended === "continue") {
      this.awaitingContinue = true;
      this.setState("waiting", undefined, true);
      return;
    }
    this.autoRun = 0;
    this.setState(ended === "done" ? "done" : "waiting", options);
  }
}

/** A model-written concept, reduced to plain words before anyone sees or builds it. */
export function cleanConcept(concept: string): string {
  return concept
    .replace(/[^\p{L}\p{N}\s,.'()&+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function safePlan(json: string): LessonPlan | null {
  try {
    const parsed = LessonPlanSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** What was said during the intake, for planning a board saved before the plan arrived. */
function intakeOf(log: ReturnType<Store["log"]>): { role: "tutor" | "student"; text: string }[] {
  const out: { role: "tutor" | "student"; text: string }[] = [];
  for (const row of log) {
    if (row.kind === "user") out.push({ role: "student", text: row.text });
    else if (row.event.type === "say") out.push({ role: "tutor", text: row.event.text });
  }
  return out.slice(-20);
}

/** The board as a short list the model can find its way around, newest last, about 4000 characters. */
function boardSummary(board: BoardState): string {
  const lines = board.blocks.map((b) => {
    const col = "column" in b ? ` col ${b.column}` : "";
    let what = "";
    if (b.type === "html") what = b.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
    else if (b.type === "image") what = b.prompt.slice(0, 80);
    else if (b.type === "annotation") what = `${b.kind} on ${b.target}${b.match ? `: "${b.match.slice(0, 40)}"` : ""}`;
    else if (b.type === "page") what = `${b.source} page ${b.page}`;
    else if (b.type === "embed") what = b.title ?? "";
    else if (b.type === "svg") what = "diagram";
    return `- ${b.id} (${b.type}${col}) ${what}`;
  });
  const text = lines.join("\n");
  return text.length > 4000 ? "...\n" + text.slice(-4000) : text || "(empty)";
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

/** The spoken side of a saved log as plain lines, most recent 8000 characters. */
function transcriptOf(log: ReturnType<Store["log"]>): string {
  const lines: string[] = [];
  for (const row of log) {
    if (row.kind === "user") lines.push(`Student: ${row.text}`);
    else if (row.event.type === "say") lines.push(`Tutor: ${row.event.text}`);
    else if (row.event.type === "section") lines.push(`[Section: ${row.event.title}]`);
  }
  const text = lines.join("\n");
  return text.length > 8000 ? "...\n" + text.slice(-8000) : text;
}
