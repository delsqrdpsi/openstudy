import { describe, expect, it } from "vitest";
import { matchOption } from "./options";

const OPTS = ["Brand new to it", "I know the basics", "Studying for an exam"];

describe("matchOption", () => {
  it("picks by number, typed or spoken", () => {
    expect(matchOption("2", OPTS)).toBe("I know the basics");
    expect(matchOption("Two.", OPTS)).toBe("I know the basics");
    expect(matchOption("the second one", OPTS)).toBe("I know the basics");
    expect(matchOption("Option 3", OPTS)).toBe("Studying for an exam");
    expect(matchOption("I'll go with the first one, please", OPTS)).toBe("Brand new to it");
    expect(matchOption("number three", OPTS)).toBe("Studying for an exam");
  });

  it("picks by the option's own words", () => {
    expect(matchOption("i know the basics!", OPTS)).toBe("I know the basics");
  });

  it("hears a lone 'to' or 'for' as a number, never inside a sentence", () => {
    expect(matchOption("to", OPTS)).toBe("I know the basics");
    expect(matchOption("I want to", OPTS)).toBeNull();
    expect(matchOption("for", ["a", "b", "c", "d"])).toBe("d");
  });

  it("leaves the student's own answer alone", () => {
    expect(matchOption("I want to build a robot arm", OPTS)).toBeNull();
    expect(matchOption("4", OPTS)).toBeNull();
    expect(matchOption("2", [])).toBeNull();
    expect(matchOption("   ", OPTS)).toBeNull();
  });
});
