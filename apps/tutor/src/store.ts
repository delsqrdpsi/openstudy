import { dataDir } from "./paths";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BoardSummary, LessonEvent, LogEntry } from "@openstudy/shared";

/**
 * Every lesson is saved as an append-only log of board events and student
 * messages, plus a board row with what is needed to pick the conversation
 * back up (the brain's session id). SQLite via Node's built-in module.
 */
export interface BoardRow {
  id: string;
  title: string;
  topic: string;
  brain: string;
  model: string;
  brainSessionId: string | null;
  planJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export class Store {
  private db: DatabaseSync;

  constructor(file = join(dataDir(), "openstudy.db")) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists boards (
        id text primary key,
        title text not null,
        topic text not null,
        brain text not null,
        model text not null,
        brain_session_id text,
        plan_json text,
        created_at integer not null,
        updated_at integer not null
      );
      create table if not exists log (
        board_id text not null references boards(id) on delete cascade,
        seq integer not null,
        kind text not null,
        json text not null,
        primary key (board_id, seq)
      );
      create table if not exists settings (
        key text primary key,
        json text not null
      );
    `);
  }

  /** Small named values that outlive a lesson, such as the Canvas connection. */
  getSetting<T>(key: string): T | null {
    const r = this.db.prepare("select json from settings where key = ?").get(key) as { json: string } | undefined;
    return r ? (JSON.parse(r.json) as T) : null;
  }

  setSetting(key: string, value: unknown) {
    this.db.prepare("insert into settings (key, json) values (?, ?) on conflict(key) do update set json = excluded.json").run(key, JSON.stringify(value));
  }

  deleteSetting(key: string) {
    this.db.prepare("delete from settings where key = ?").run(key);
  }

  createBoard(b: Omit<BoardRow, "createdAt" | "updatedAt" | "brainSessionId" | "planJson">): BoardRow {
    const now = Date.now();
    this.db
      .prepare("insert into boards (id, title, topic, brain, model, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
      .run(b.id, b.title, b.topic, b.brain, b.model, now, now);
    return { ...b, brainSessionId: null, planJson: null, createdAt: now, updatedAt: now };
  }

  getBoard(id: string): BoardRow | null {
    const r = this.db.prepare("select * from boards where id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? rowToBoard(r) : null;
  }

  listBoards(limit = 50): BoardSummary[] {
    const rows = this.db
      .prepare(
        `select b.id, b.title, b.topic, b.model, b.created_at, b.updated_at,
           (select count(*) from log l where l.board_id = b.id and l.kind = 'event' and l.json like '%"block.add"%') as blocks
         from boards b order by b.updated_at desc, b.rowid desc limit ?`,
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      topic: String(r.topic),
      model: String(r.model),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      blocks: Number(r.blocks),
    }));
  }

  deleteBoard(id: string) {
    this.db.prepare("delete from log where board_id = ?").run(id);
    this.db.prepare("delete from boards where id = ?").run(id);
  }

  setTitle(id: string, title: string) {
    this.db.prepare("update boards set title = ?, updated_at = ? where id = ?").run(title, Date.now(), id);
  }

  setModel(id: string, model: string) {
    this.db.prepare("update boards set model = ? where id = ?").run(model, id);
  }

  setBrainSession(id: string, sessionId: string) {
    this.db.prepare("update boards set brain_session_id = ? where id = ?").run(sessionId, id);
  }

  setPlan(id: string, planJson: string) {
    this.db.prepare("update boards set plan_json = ? where id = ?").run(planJson, id);
  }

  append(boardId: string, entry: LogEntry) {
    const next = (this.db.prepare("select coalesce(max(seq), 0) + 1 as n from log where board_id = ?").get(boardId) as { n: number }).n;
    this.db.prepare("insert into log (board_id, seq, kind, json) values (?, ?, ?, ?)").run(boardId, next, entry.kind, JSON.stringify(entry));
    this.db.prepare("update boards set updated_at = ? where id = ?").run(Date.now(), boardId);
  }

  appendEvent(boardId: string, event: LessonEvent) {
    this.append(boardId, { kind: "event", event });
  }

  log(boardId: string): LogEntry[] {
    const rows = this.db.prepare("select json from log where board_id = ? order by seq").all(boardId) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as LogEntry);
  }

  close() {
    this.db.close();
  }
}

function rowToBoard(r: Record<string, unknown>): BoardRow {
  return {
    id: String(r.id),
    title: String(r.title),
    topic: String(r.topic),
    brain: String(r.brain),
    model: String(r.model),
    brainSessionId: r.brain_session_id ? String(r.brain_session_id) : null,
    planJson: r.plan_json ? String(r.plan_json) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}
