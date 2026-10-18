import { formatHits, splitChunks, terms } from "./index";

describe("course index", () => {
  it("stems and drops stop words", () => {
    expect(terms("The eigenvalues of a matrix are scaling factors")).toEqual(["eigenvalue", "matrix", "scal", "factor"]);
  });

  it("splits a deck by page and long text by size", () => {
    const deck = "--- page 1 ---\nTitle slide\n\n--- page 2 ---\nNewton's second law\n\nF = ma\n\n--- page 3 ---\n" + "x ".repeat(1200);
    const chunks = splitChunks(deck);
    expect(chunks.map((c) => c.page)).toEqual([1, 2, 3, 3]);
    expect(chunks[1].text).toBe("Newton's second law\n\nF = ma");
    const plain = splitChunks(Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(60)).join("\n\n"));
    expect(plain.length).toBeGreaterThan(2);
    expect(plain.every((c) => c.page === undefined)).toBe(true);
  });

  it("formats hits by item with slide numbers", () => {
    const text = formatHits([
      { item: "Lecture 4.pdf", kind: "file", group: "Week 2", page: 7, text: "Range R = v^2 sin 2θ / g", score: 2 },
      { item: "Lecture 4.pdf", kind: "file", group: "Week 2", page: 3, text: "Projectiles", score: 1 },
      { item: "HW 2", kind: "assignment", group: "Assignments", text: "Find the range", score: 1 },
    ]);
    expect(text).toBe("--- Lecture 4.pdf (file, Week 2) ---\n[slide 3]\nProjectiles\n\n[slide 7]\nRange R = v^2 sin 2θ / g\n\n--- HW 2 (assignment, Assignments) ---\nFind the range");
    expect(formatHits([])).toBe("(nothing in the course matched)");
  });
});
