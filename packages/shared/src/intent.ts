/**
 * What a short line from the student asks of the lesson itself, rather than
 * of the tutor: a different pace, a pause, or the go-ahead. Shared by the
 * client (which pauses or continues on the spot) and the server (which
 * remembers the pace for every later turn), so both read the same words
 * the same way. Anything longer or less plain is a message for the tutor.
 */

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => (s ? s.split(" ").length : 0);

const SLOW = /\b(slow(er)? down|slower|too fast|not so fast|go slow(er|ly)?|take it slow(er|ly)?|slow(ly)? please|more slowly)\b/;
const NORMAL = /\b(faster|speed (it )?up|too slow|normal (speed|pace)|regular (speed|pace)|usual (speed|pace)|pick up the pace|go quicker|quicker)\b/;
const MOMENT = "(sec|second|moment|minute|min|bit)";
const PAUSE = new RegExp(`^(wait|hold on|hang on|hold up|pause|stop|hold that thought)( (a|one|just a|for a) ${MOMENT})?( please)?$|^((just |give me |gimme )?(a|one) ${MOMENT})( please)?$`);
const GO = /^((ok|okay|alright|all right|right|yes|yep|yeah|sure|fine|cool|good)( |$))*(go on|go ahead|go|continue|carry on|keep going|next|proceed|ready|got it|done|move on|let's go|lets go|resume|play)?( please)?( now)?$/;

/** The student wants the lesson slower, or back to normal speed. Null for anything else. */
export function paceRequest(text: string): "slow" | "normal" | null {
  const s = norm(text);
  if (!s || words(s) > 8) return null;
  const slow = SLOW.test(s);
  const normal = NORMAL.test(s);
  if (slow === normal) return null;
  return slow ? "slow" : "normal";
}

/** The student wants the tutor to hold where it is: a pause word, or a request to slow down. */
export function pauseRequest(text: string): boolean {
  const s = norm(text);
  if (!s || words(s) > 6) return false;
  return PAUSE.test(s) || paceRequest(text) === "slow";
}

/** The student is ready to go on: a bare "ok", "go on", "next", with nothing else in the line. */
export function goOnRequest(text: string): boolean {
  const s = norm(text);
  if (!s || words(s) > 5) return false;
  return GO.test(s);
}
