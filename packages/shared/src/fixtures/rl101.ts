import type { LessonFixture, TimedEvent } from "../events";
import type { Block } from "../blocks";
import { chunkHtml } from "../stream";

/**
 * A scripted lesson used to develop the board with no model and no network.
 * Timing mimics a tutor that writes while it talks. The rhythm is the one the
 * product uses: explain, ask, listen, adapt, return to the plan.
 */

const CPS = 45; // characters per second of "handwriting"

class Script {
  events: TimedEvent[] = [];
  t = 0;
  at(ms: number) {
    this.t = ms;
    return this;
  }
  wait(ms: number) {
    this.t += ms;
    return this;
  }
  say(text: string, holdMs?: number) {
    this.events.push({ at: this.t, event: { type: "say", text } });
    this.t += holdMs ?? Math.max(1200, text.length * 55);
    return this;
  }
  section(title: string) {
    this.events.push({ at: this.t, event: { type: "section", title } });
    return this;
  }
  /** Stream an html block over time as if written by hand. */
  write(id: string, column: number, html: string) {
    this.events.push({ at: this.t, event: { type: "block.add", block: { id, type: "html", column, html: "" } } });
    for (const chunk of chunkHtml(html, 6)) {
      this.events.push({ at: this.t, event: { type: "block.append", id, html: chunk } });
      this.t += (chunk.replace(/<[^>]+>/g, "").length / CPS) * 1000;
    }
    return this;
  }
  add(block: Block) {
    this.events.push({ at: this.t, event: { type: "block.add", block } });
    return this;
  }
  imageReady(id: string, url: string) {
    this.events.push({ at: this.t, event: { type: "image.update", id, status: "ready", url } });
    return this;
  }
  annotate(id: string, target: string, kind: "highlight" | "circle" | "underline", match: string) {
    this.events.push({ at: this.t, event: { type: "block.add", block: { id, type: "annotation", target, kind, match } } });
    return this;
  }
  /** Annotate part of a picture or diagram by region (fractions of its box). */
  annotateRegion(id: string, target: string, kind: "highlight" | "circle", region: { x: number; y: number; w: number; h: number }) {
    this.events.push({ at: this.t, event: { type: "block.add", block: { id, type: "annotation", target, kind, match: "", region } } });
    return this;
  }
}

const s = new Script();

s.at(0)
  .section("What reinforcement learning is")
  .say("Okay, let's start with the big picture. Reinforcement learning is learning by trying things and seeing what happens.")
  .write("title", 0, "<h1>Reinforcement Learning 101</h1>")
  .write(
    "big_picture",
    0,
    "<b>The idea:</b> an <b>agent</b> acts in an <b>environment</b>, gets a <b>reward</b>, and slowly figures out what works.<br><i>No answer key. Just feedback.</i>",
  )
  .add({
    id: "loop_sketch",
    type: "image",
    column: 1,
    prompt: "A small robot in a maze reaching for a glowing coin, with an arrow loop labelled action, state, reward",
    status: "pending",
  })
  .say("While that picture loads, here is the loop that everything else hangs on.")
  .write(
    "loop",
    0,
    "<h3>The loop</h3>Action $\\rightarrow$ State changes $\\rightarrow$ Reward $\\rightarrow$ Better action next time.",
  )
  .wait(400)
  .imageReady("loop_sketch", "/fixtures/loop_sketch.svg")
  .say("Quick check before we go on. If a robot vacuum bumps into a wall and loses a point, which part of the loop is the lost point?")
  .annotate("ann_reward", "loop", "circle", "Reward")
  .wait(2500)
  .say("Right, that's the reward. Negative reward is still reward. The agent learns to avoid it.")
  .annotateRegion("ann_coin", "loop_sketch", "circle", { x: 0.52, y: 0.5, w: 0.14, h: 0.26 })
  .say("In the sketch, that coin is the reward the robot is after.")
  .annotate("ann_feedback", "big_picture", "highlight", "Just feedback")
  .wait(800)

  .section("Three ways to learn a skill")
  .say("Now let's compare this with the other way machines learn skills, copying a teacher.")
  .write(
    "three_ways",
    0,
    "<h3>Three ways to learn</h3>1. <b>Supervised:</b> here is the input, here is the right answer. Memorise the mapping.<br>2. <b>Imitation:</b> watch an expert do it, copy the moves.<br>3. <b>Reinforcement:</b> try, get a score, adjust.",
  )
  .add({
    id: "compare_table",
    type: "html",
    column: 1,
    html:
      '<table><tr><th>Feature</th><th>Imitation</th><th>Reinforcement</th></tr>' +
      "<tr><td><b>Needs</b></td><td>Expert demos</td><td>A reward signal</td></tr>" +
      "<tr><td><b>Ceiling</b></td><td>As good as the expert</td><td>Can beat the expert</td></tr>" +
      "<tr><td><b>Failure</b></td><td>Drifts off the demo path</td><td>Slow, needs many tries</td></tr></table>",
  })
  .say("Imitation gets you to the teacher's level fast. Reinforcement can go past the teacher, but it takes a lot of tries.")
  .add({
    id: "perf_chart",
    type: "svg",
    column: 1,
    width: 300,
    height: 200,
    caption: "Imitation starts strong; RL keeps climbing.",
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">' +
      '<line x1="40" y1="160" x2="280" y2="160" stroke="#222" stroke-width="1.5"/>' +
      '<line x1="40" y1="160" x2="40" y2="30" stroke="#222" stroke-width="1.5"/>' +
      '<text x="160" y="185" font-size="14" text-anchor="middle" fill="#222">Training time</text>' +
      '<text x="18" y="100" font-size="14" text-anchor="middle" fill="#222" transform="rotate(-90 18 100)">Skill</text>' +
      '<path d="M40 150 C 80 60, 120 55, 280 52" fill="none" stroke="#0085CF" stroke-width="2.5"/>' +
      '<path d="M40 155 C 140 150, 200 110, 280 30" fill="none" stroke="#C73C3C" stroke-width="2.5"/>' +
      '<text x="120" y="48" font-size="13" fill="#0085CF">Imitation</text>' +
      '<text x="225" y="70" font-size="13" fill="#C73C3C">RL</text>' +
      "</svg>",
  })
  .annotate("ann_ceiling", "compare_table", "highlight", "Can beat the expert")
  .say("Here's a question for you. Why can reinforcement learning end up better than the expert it never watched?")
  .wait(3000)
  .say("Close. The key is that the reward doesn't care how the expert did it. Any path that scores higher wins, including ones no human tried.")
  .write(
    "why_beats",
    1,
    "<b>Why RL can beat the teacher:</b> the reward only measures the outcome, so any move that scores better is kept, even moves no human would try.",
  )
  .wait(600)

  .section("Learning to ride a bike")
  .say("Let me make this concrete with a bike.")
  .write(
    "bike",
    2,
    "<h3>Learning to ride a bike</h3><b>Imitation:</b> a coach holds your hands and moves them. You copy the exact motions.<br><br><b>RL:</b> you get on, wobble, fall, and every ten metres without falling earns a cookie. Nobody shows you how. You find the balance yourself.",
  )
  .add({
    id: "bike_sketch",
    type: "image",
    column: 2,
    prompt: "Child on a bicycle wobbling, a trail of small cookies behind, pencil sketch",
    status: "pending",
  })
  .wait(2500)
  .imageReady("bike_sketch", "/fixtures/bike_sketch.svg")
  .annotate("ann_cookie", "bike", "underline", "earns a cookie")
  .say("So, in the bike story, what is the reward, and what is the policy? Take your time.")
  .wait(3500)
  .say("The cookie is the reward. The policy is the thing in your head that turns 'I am tipping left' into 'steer left'. That's what gets better.")
  .write(
    "policy_def",
    2,
    "<b>Policy:</b> the rule that maps what you sense to what you do. $\\pi(a \\mid s)$. RL improves the policy, not a recording of moves.",
  )
  .wait(500)
  .say("Want to go back to the plan? Next up is how the reward actually gets turned into learning. Or we can stay on the bike a bit longer.")
  .write("outline", 3, "<h3>Plan</h3>1. What RL is ✓<br>2. Three ways to learn ✓<br>3. The bike example ✓<br>4. From reward to learning<br>5. Where it breaks");

export const rl101: LessonFixture = {
  id: "rl101",
  title: "Reinforcement Learning 101",
  events: s.events,
};
