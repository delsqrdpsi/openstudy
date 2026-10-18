import { BOARD_ID } from "@openstudy/shared";

/** Small pure helpers for the live lesson connection, kept apart so they can be tested without a browser. */

/** Wait before reconnect attempt `n` (0-based): 0.5s, doubling, at most 8s. */
export function reconnectDelay(attempt: number, base = 500, max = 8000): number {
  return Math.min(max, base * 2 ** Math.max(0, Math.min(attempt, 30)));
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/**
 * A board id chosen on the client, nanoid-style (21 characters of A-Za-z0-9_-),
 * so the lesson has its address before the server answers and a reload
 * reopens the same board instead of starting a second one.
 */
export function newBoardId(size = 21): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let id = "";
  // 64 symbols: the low six bits of a random byte pick one without bias.
  for (const b of bytes) id += ALPHABET[b & 63];
  return id;
}

export function isBoardId(id: string | null | undefined): id is string {
  return !!id && BOARD_ID.test(id);
}

/** Trim and cut text to what the server accepts, so a long paste is sent rather than rejected. */
export function clipText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  // Do not split a surrogate pair at the cut.
  let end = max;
  const code = t.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return t.slice(0, end).trimEnd();
}
