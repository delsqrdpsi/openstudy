/**
 * The tutor's answer options, picked by what the student typed or said
 * instead of a click: "2", "the second one", "option two", or the option's
 * own words. Anything else is the student's own answer and stays as it is.
 */
const ORDINALS: Record<string, number> = {
  "1": 0, one: 0, first: 0, "1st": 0,
  "2": 1, two: 1, to: 1, too: 1, second: 1, "2nd": 1,
  "3": 2, three: 2, third: 2, "3rd": 2,
  "4": 3, four: 3, for: 3, fourth: 3, "4th": 3,
  "5": 4, five: 4, fifth: 4, "5th": 4,
  "6": 5, six: 5, sixth: 5, "6th": 5,
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// "I'll go with the second one please", "option 2", "number two", "3".
const PICK = /^(?:(?:i ll |i will |i d |let s )?(?:pick|choose|take|go with|say|want) )?(?:the )?(?:option |number |answer |choice )?(\S+)(?: one| option| please)*$/;

export function matchOption(text: string, options: readonly string[]): string | null {
  if (!options.length) return null;
  const said = norm(text);
  if (!said) return null;
  const same = options.find((o) => norm(o) === said);
  if (same) return same;
  const m = PICK.exec(said);
  // "to", "too" and "for" are what speech-to-text hears for a lone "two" or "four"; only alone do they count.
  const word = m?.[1];
  if (!word || (["to", "too", "for"].includes(word) && said !== word)) return null;
  const i = ORDINALS[word];
  return i !== undefined && i < options.length ? options[i] : null;
}
