import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, plainSpeech } from "./text";

describe("plainSpeech", () => {
  it("drops the board's styling tags", () => {
    expect(plainSpeech("These are the <b>Actor</b> and the <i>Critic</i>.")).toBe("These are the Actor and the Critic.");
    expect(plainSpeech('The <B>loop</B> and the <span class="x">reward</span>')).toBe("The loop and the reward");
  });

  it("keeps words apart across line-break, list and table tags", () => {
    expect(plainSpeech("first line<br>second line")).toBe("first line second line");
    expect(plainSpeech("one<br/>two<br />three")).toBe("one two three");
    expect(plainSpeech("<ul><li>state</li><li>action</li></ul>")).toBe("state action");
    expect(plainSpeech("<tr><td>left</td><td>right</td></tr>")).toBe("left right");
  });

  it("keeps comparisons and generics that look a little like tags", () => {
    expect(plainSpeech("when x<y and y>z we stop")).toBe("when x<y and y>z we stop");
    expect(plainSpeech("a List<String> holds strings")).toBe("a List<String> holds strings");
    expect(plainSpeech("So a < b and b > c")).toBe("So a < b and b > c");
    expect(plainSpeech("an <input> element")).toBe("an <input> element");
  });

  it("turns entities back into characters", () => {
    expect(plainSpeech("the <b>Actor</b> &amp; the Critic")).toBe("the Actor & the Critic");
    expect(plainSpeech("x &lt; y&nbsp;and &#39;quoted&#39; &#x2014; done")).toBe("x < y and 'quoted' — done");
  });

  it("drops markdown bold and code marks", () => {
    expect(plainSpeech("the **Actor** and the __Critic__")).toBe("the Actor and the Critic");
    expect(plainSpeech("call `step()` once")).toBe("call step() once");
    expect(plainSpeech("2 * 3 * 4 is 24")).toBe("2 * 3 * 4 is 24");
  });

  it("drops math delimiters and keeps money", () => {
    expect(plainSpeech("the **Actor** updates $Q(s,a)$ each step")).toBe("the Actor updates Q(s,a) each step");
    expect(plainSpeech("so $$V = r + \\gamma V'$$ holds")).toBe("so V = r + \\gamma V' holds");
    expect(plainSpeech("it costs $5 and $10 a month")).toBe("it costs $5 and $10 a month");
    expect(plainSpeech("it costs \\$120")).toBe("it costs $120");
  });

  it("collapses whitespace and trims", () => {
    expect(plainSpeech("  <br> hello \n  there <br>")).toBe("hello there");
    expect(plainSpeech("<b></b>")).toBe("");
  });
});

describe("htmlToText", () => {
  it("flattens a board block to one line", () => {
    expect(htmlToText("<h3>The idea</h3>An <b>agent</b> acts.<br><i>No answer key.</i>")).toBe("The idea An agent acts. No answer key.");
    expect(htmlToText("Q &amp; A")).toBe("Q & A");
  });
});

describe("decodeEntities", () => {
  it("leaves unknown and out-of-range entities as written", () => {
    expect(decodeEntities("&bogus; &#0; &#x110000;")).toBe("&bogus; &#0; &#x110000;");
  });
});
