import { ProtocolParser, parseAttrs, parseProtocol } from "./protocol";
import { applyEvents, emptyBoard } from "./board";
import type { LessonEvent } from "./events";

const SAMPLE = `@say Let's start with the loop.
@section What RL is
@html id=big_picture col=0
<b>The idea:</b> an agent acts, gets a <i>reward</i>.
Math: $a \\rightarrow b$
@end
@image id=loop_sketch col=1 prompt="A robot in a maze, pencil sketch" caption="the loop"
@svg id=chart col=1 caption="skill over time"
<svg viewBox="0 0 300 200"><line x1="0" y1="0" x2="10" y2="10"/></svg>
@end
@annotate id=ann1 target=big_picture kind=circle match="reward"
@focus id=big_picture
@ask
`;

describe("protocol", () => {
  it("parses a whole message", () => {
    const { events, signals } = parseProtocol(SAMPLE);
    const s = applyEvents(emptyBoard(), events);
    expect(s.sections).toEqual(["What RL is"]);
    expect(s.caption).toBe("Let's start with the loop.");
    const html = s.blocks.find((b) => b.id === "big_picture");
    expect(html).toMatchObject({ type: "html", column: 0 });
    expect((html as { html: string }).html).toContain("<i>reward</i>.\nMath: $a \\rightarrow b$");
    expect(s.blocks.find((b) => b.id === "loop_sketch")).toMatchObject({ type: "image", prompt: "A robot in a maze, pencil sketch", status: "pending" });
    expect(s.blocks.find((b) => b.id === "chart")).toMatchObject({ type: "svg", caption: "skill over time" });
    expect(s.blocks.find((b) => b.id === "ann1")).toMatchObject({ type: "annotation", target: "big_picture", kind: "circle", match: "reward" });
    expect(s.focusId).toBe("big_picture");
    expect(signals).toEqual([{ type: "ask" }]);
  });

  it("gives the same result for any chunking and never splits a tag", () => {
    const whole = parseProtocol(SAMPLE);
    for (const size of [1, 2, 3, 7, 13, 50]) {
      const events: LessonEvent[] = [];
      const p = new ProtocolParser({ event: (e) => events.push(e), signal: () => {} });
      for (let i = 0; i < SAMPLE.length; i += size) p.feed(SAMPLE.slice(i, i + size));
      p.end();
      for (const e of events) {
        if (e.type === "block.append") {
          expect((e.html.match(/</g) ?? []).length).toBe((e.html.match(/>/g) ?? []).length);
        }
      }
      expect(applyEvents(emptyBoard(), events)).toEqual(applyEvents(emptyBoard(), whole.events));
    }
  });

  it("streams html before the line is complete", () => {
    const events: LessonEvent[] = [];
    const p = new ProtocolParser({ event: (e) => events.push(e), signal: () => {} });
    p.feed("@html id=a col=0\nHello there, <b>wor");
    const appended = events.filter((e) => e.type === "block.append").map((e) => (e as { html: string }).html).join("");
    // A complete <b> tag may stream; only an unfinished tag is held back.
    expect(appended).toBe("Hello there, <b>wor");
    p.feed("ld</b>\n@end\n");
    const all = events.filter((e) => e.type === "block.append").map((e) => (e as { html: string }).html).join("");
    expect(all).toBe("Hello there, <b>world</b>\n");
  });

  it("dedupes ids, reports bad commands, treats bare prose as narration", () => {
    const { events, signals } = parseProtocol("@html id=x col=0\nA\n@end\n@html id=x col=0\nB\n@end\n@bogus\nJust talking.\n");
    const adds = events.filter((e) => e.type === "block.add").map((e) => (e as { block: { id: string } }).block.id);
    expect(adds).toEqual(["x", "x_2"]);
    expect(signals[0]).toMatchObject({ type: "error" });
    expect(events.at(-1)).toEqual({ type: "say", text: "Just talking." });
  });

  it("parses region and named positions on annotations", () => {
    const { events, signals } = parseProtocol('@annotate id=a target=pic kind=circle at=top-left\n@annotate id=b target=pic kind=highlight region="0.1,0.2,0.5,0.25"\n@annotate id=c target=pic kind=circle\n');
    expect(events[0]).toMatchObject({ type: "block.add", block: { id: "a", region: { x: 0.03, y: 0.03 } } });
    expect(events[1]).toMatchObject({ type: "block.add", block: { id: "b", region: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 } } });
    expect(events).toHaveLength(2);
    expect(signals[0]).toMatchObject({ type: "error" });
  });

  it("parses motion blocks, figures and build requests", () => {
    const { events, signals } = parseProtocol(
      '@motion id=piston col=1 caption="up and down"\n<svg viewBox="0 0 300 200"><rect x="10" y="10" width="20" height="40"><animate attributeName="y" values="10;100;10" dur="2s" repeatCount="indefinite"/></rect></svg>\n@end\n@figure id=dial col=1 name=dial-indicator caption="a real dial"\n@build_figure name=four_stroke concept="a four-stroke engine cylinder with the valves timed to the crank"\n',
    );
    expect(events[0]).toMatchObject({ type: "block.add", block: { id: "piston", type: "svg", motion: true, caption: "up and down" } });
    expect(signals).toEqual([
      { type: "figure", id: "dial", column: 1, name: "dial-indicator", caption: "a real dial" },
      { type: "build_figure", name: "four_stroke", concept: "a four-stroke engine cylinder with the valves timed to the crank" },
    ]);
  });

  it("parses page placements", () => {
    const { signals } = parseProtocol('@page id=slide_7 col=2 source="lecture3.pdf" page=7 caption="the key slide"\n');
    expect(signals).toEqual([{ type: "page", id: "slide_7", column: 2, source: "lecture3.pdf", page: 7, caption: "the key slide" }]);
  });

  it("parses continue", () => {
    expect(parseProtocol("@say Next up, the rack.\n@continue\n").signals).toEqual([{ type: "continue" }]);
  });

  it("parses ask options", () => {
    const { signals } = parseProtocol('@say Which one?\n@ask options="A motor burnout|A logic hang|A broken sensor"\n');
    expect(signals).toEqual([{ type: "ask", options: ["A motor burnout", "A logic hang", "A broken sensor"] }]);
  });

  it("parses quoted attributes with escapes", () => {
    expect(parseAttrs('id=a col=1 match="say \\"hi\\"" caption=\'it\\\'s\'')).toEqual({ id: "a", col: "1", match: 'say "hi"', caption: "it's" });
  });
});
