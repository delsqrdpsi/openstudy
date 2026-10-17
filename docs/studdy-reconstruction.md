# What Studdy's tutor prompt probably says

I could not log in and take a lesson from this environment (no browser on
your machine is linked, and the sandbox cannot reach studdyai.com). This is
a reconstruction from hard evidence, with the inferences marked.

## Evidence

From the rendered DOM of a live lesson (`tutor-session/<id>`):

- The model emits blocks with human-readable snake_case ids: `lesson_title`,
  `concept_1`, `rl_vs_il`, `rl_loop`, `comparison_table`, `basics_recap`,
  `example_scenario`, `hybrid_approach`, `teleop_vs_il`,
  `playback_vs_learning`, `training_techniques`, `robot_sketch`,
  `sft_explanation`, `graph_learning`, `teleop_viz`, `diffusion_viz`,
  `diffusion_concept`, `diff_vs_standard`, `sculpting_analogy`. So the tool
  schema asks for an `id` and the model names them after the content.
- Text blocks are raw HTML: `<h1>`, `<h3>`, `<b>`, `<i>`, `<br>`, and full
  `<table border="1" style="border-collapse: collapse; width: 100%">` with
  inline `style="padding: 8px; background-color: #f2f2f2;"` on cells. The
  prompt therefore allows inline styles and probably shows a table example.
- Math is written as LaTeX (`\rightarrow`, `X, Y, Z`) and rendered with KaTeX.
- Images: `data-image-id`, one per concept, 528 by 288, named after the
  concept (`robot_sketch`, `teleop_viz`, `diffusion_viz`,
  `sculpting_analogy`). The prompt asks for a prompt per picture; the style
  is consistent (pencil and watercolor, labelled panels), so a style suffix
  is added server side.
- SVG diagrams carry `data-descriptor="legend"`, `data-descriptor="axes"`,
  `classname="pure-rl-key"`, `data-name="performance-over-time"`. The model
  is asked to label parts of a diagram with descriptors and class names.
  `classname` (lowercase) is an LLM slip the pipeline tolerates.
- Annotations: a highlight on a measured text span, a circle with a
  draw-on animation. Tool calls carry a target block id and the text to
  mark. The `(Iterative)` circle lands on the exact phrase the tutor is
  saying at that moment, so annotations are emitted inline with speech.
- Three columns of content, each about one sub-topic. Column position is
  computed by the client; the model chooses a column or section.
- The lesson progression: title and pedigree, breakdown, "RL 101" loop,
  a comparison table, a "Core Concepts Recap", a "'Learning to Bike'
  Example", a "Hybrid" section, then answers to follow-up questions
  (teleop vs imitation, playback vs policy, "Top Robotics Training
  Techniques"). Pattern: define, compare, recap, concrete analogy, extend on
  the student's questions.

From the transcript line you pasted:

> "Ayy, look who's back! Welcome back to the jam session, dank! Hope you had
> a good break. We were deep in the paint on Diffusion and how it uses
> neural networks to 'sculpt' perfect robot moves."

So the voice is a named persona with slang ("jam session", "deep in the
paint"), uses the student's name, and resumes by summarising where the
lesson was. The tutor picker names two personas: "Alfrenzo: energetic and
fun" and "Rubie: warm and friendly", so tone is a prompt parameter.

From the product's own UI strings (next-intl messages in the page):

- Modes: Topic, Homework ("Learn how to do it yourself"), Exam Prep.
- Onboarding stores grade level ("Used to navigate studdy"), preferred
  language, and name ("This is the name we are gonna use when we talk to
  you"). These are injected into the prompt.
- A "collapse-context" API call: the conversation is summarised periodically.
- "heartbeat" and "check-session-gating": the paywall timer, not the model.
- End-of-lesson stats: minutes, turns, concepts. "Concepts" is likely a
  count of sections or blocks the model declared.
- Speech speed setting; captions with word timing from TTS.
- Student can attach PDFs, images, text and links; the UI says long
  documents are outlined ("Building outline...") before the lesson.

## Inferred prompt

What follows is my best reconstruction. The shape is confident; the exact
wording is not.

```
You are {tutor_name}, a {persona} one-on-one tutor teaching {student_name}
({grade_level}) on an interactive whiteboard. Speak {language}. Keep spoken
turns short and conversational; you are talking, not writing an essay.

Mode: {Topic | Homework | Exam Prep}. {mode_instructions}
Student materials: {outline of attached documents}.

You teach by talking and writing on the board at the same time. Use the
board tools for everything visual:
- write_html(id, html): headings, bold key terms, short lines, <br> breaks,
  tables for comparisons (border-collapse, padded cells, shaded header).
  LaTeX for math. One idea per block. Name ids after the content.
- draw_svg(id, svg, name): a clean diagram or chart with labelled parts
  (data-descriptor on groups). It will be redrawn in a hand-drawn style.
- show_image(id, prompt): a pencil-sketch illustration, one per concept,
  with a short descriptive prompt. Request it before you explain so it
  loads while you talk.
- annotate(target_id, kind: highlight|circle|underline, text): mark the
  exact words you are talking about, at the moment you say them.
- new_section / column: start a new column for each sub-topic.

Lesson rhythm: open with a title and the big picture; define each term;
compare related ideas in a table; give a concrete analogy or scenario;
recap core concepts in a block; then check understanding with a question
and wait. When the student asks something, answer it on the board in a new
block next to the related material and return to the plan. If they say
something wrong, correct it kindly with a fresh example.

Persona: {Alfrenzo: energetic, playful, slang, hype the student |
Rubie: warm, calm, encouraging}. Use the student's name now and then.

When resuming a lesson, greet them and recap where you left off in one or
two lines before continuing.
```

## What is already the same in OpenStudy

Block ids, raw HTML with tables, LaTeX, one picture per concept requested
before the explanation, inline annotations timed to speech, a column per
section, the recap-then-question rhythm, context folding, resume with a
recap. The differences are deliberate: no multiple choice, our own look,
a planner on Fable, browser voice.

## How to get the real thing

The authoritative source is the live session itself:

1. Link your computer: open the Claude Desktop app, or run
   `claude remote-control` in the repo folder, and continue this work in
   that session. It can then use your logged-in browser to take a lesson
   and read the network responses.
2. Or, in your own browser during a lesson, open DevTools, Network, click
   a `generate-response` request, and copy the Response tab. That body is
   the tool-call stream (block ids, html, svg, image prompts, annotations)
   and shows the exact tool names and arguments. Paste it here and I will
   align our protocol and prompt to it line by line.
