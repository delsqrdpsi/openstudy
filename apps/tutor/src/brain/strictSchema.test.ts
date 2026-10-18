import { describe, expect, it } from "vitest";
import { LESSON_PLAN_JSON_SCHEMA, LessonPlanSchema } from "@openstudy/shared";
import { nullsToUndefined, strictJsonSchema } from "./strictSchema";

type Obj = { properties?: Record<string, Obj>; required?: string[]; additionalProperties?: boolean; items?: Obj; anyOf?: Obj[] };

/** Every object schema in the tree, wherever it sits. */
function objects(s: Obj): Obj[] {
  const found: Obj[] = s.properties ? [s] : [];
  for (const p of Object.values(s.properties ?? {})) found.push(...objects(p));
  if (s.items) found.push(...objects(s.items));
  for (const a of s.anyOf ?? []) found.push(...objects(a));
  return found;
}

describe("strictJsonSchema", () => {
  const strict = strictJsonSchema(LESSON_PLAN_JSON_SCHEMA) as Obj;

  it("requires every property and closes every object", () => {
    const all = objects(strict);
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const o of all) {
      expect(o.required?.sort()).toEqual(Object.keys(o.properties!).sort());
      expect(o.additionalProperties).toBe(false);
    }
  });

  it("makes optional fields nullable and leaves required ones alone", () => {
    const section = strict.properties!.sections.items!;
    expect(section.properties!.example.anyOf?.[1]).toEqual({ type: "null" });
    expect(section.properties!.title.anyOf).toBeUndefined();
  });

  it("round-trips a strict answer through the zod schema", () => {
    const answer = {
      title: "Cells",
      student: "first year",
      sections: [
        { id: "membrane", title: "Membrane", goal: "g", keyPoints: ["a"], example: null, checkQuestion: "q", checkOptions: null, pitfalls: null, images: [] },
        { id: "nucleus", title: "Nucleus", goal: "g", keyPoints: ["b"], example: "e", checkQuestion: "q", checkOptions: ["x", "y"], pitfalls: null, images: [] },
      ],
    };
    const plan = LessonPlanSchema.parse(nullsToUndefined(answer));
    expect(plan.sections[0].example).toBeUndefined();
    expect(plan.sections[1].checkOptions).toEqual(["x", "y"]);
  });
});
