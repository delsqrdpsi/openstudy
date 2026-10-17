# OpenStudy: replicating a Studdy-style whiteboard tutor

A voice tutor that writes on a zoomable whiteboard, draws diagrams, generates
sketch images, can be interrupted, and leaves a board you can come back to.

This document has two parts. Part A is what the real product's page markup
reveals about how it is built. Part B is the build plan, adjusted to match.

---

## Part A. What the Studdy DOM tells us

Source: the rendered DOM of a live tutor session page (`studdyai.com/tutor-session/<id>`).

### It is not Figma

The CSS classes are `figboard-viewport`, `figboard-world`, `figboard-canvas`,
`figboard-item`. "figboard" is the product's own name for its board component.
Nothing on the page loads Figma, tldraw, Excalidraw, or any canvas library.
The board is plain HTML and SVG with CSS transforms.

### How the board works

| Layer | What it is | Evidence |
|---|---|---|
| Viewport | A fixed, full-screen div that captures pan and zoom input | `.figboard-viewport` with `cursor: default` |
| World | One child div with `transform: translate(x, y) scale(s)` and `transform-origin: 0 0` | `scale(0.560478)` at the 56% zoom shown in the UI |
| Canvas | A sized div so the world has a scrollable extent | `min-width: 2445px; min-height: 3188px` |
| Items | Absolutely positioned divs, one per block, each with `transform: translate(x, y)` | `.figboard-item[data-item-id="rl_loop"]` |

Pan and zoom cost one transform on one element. Everything inside is normal
DOM, so text stays selectable, fonts render crisply, and KaTeX works.

### Layout is computed by the client, not the model

Items sit in columns at fixed x offsets (0, 749, 1357, 1877 px) and stack
vertically inside a column. The model never emits coordinates. It emits
blocks with ids; the client flows them into columns and measures heights.
Text columns are about 565 px wide; images are capped at 528 by 288 px.

### Block ids are human-readable and chosen by the model

`lesson_title`, `concept_1`, `rl_vs_il`, `rl_loop`, `comparison_table`,
`basics_recap`, `robot_sketch`, `graph_learning`, `diffusion_viz`,
`diff_vs_standard`. These let the tutor refer back to a block later
("circle the word Iterative in diff_vs_standard").

### Three block types

1. **HTML text** (`.html-element`, `data-html-id`). Raw HTML from the model:
   `h1`, `h3`, `b`, `i`, `br`, and full `<table>` markup with inline styles.
   Rendered in a handwriting font stack set as a CSS variable:
   `Caveat, Kalam, Mynerve, Nanum Pen Script, Noto Sans KR, ...`.
   Math is KaTeX, loaded from a CDN, so `\rightarrow` and `X, Y, Z` render inline.
2. **Image** (`.image-element`, `data-image-id`). A generated PNG stored in a
   public Supabase Storage bucket named `generated_images`, keyed as
   `<timestamp>-<block_id>.png`, served through a blob URL.
3. **SVG diagram** (`.svg-element`, `data-svg-id`). A model-authored SVG with a
   fixed 300 by 200 viewBox. Telltale signs it came straight from an LLM:
   attributes written as `classname` and `data-descriptor`.

### The SVG is post-processed to look hand-drawn

The raw model SVG is clean lines. The client rewrites it:

- Every path is re-emitted as jittered cubic Beziers, so a straight axis
  becomes `M50.46 43.43 C50.29 85.10, 49.70 128.19, 50.46 157.47`. This is the
  rough.js approach: perturb endpoints and control points slightly.
- A shared `feTurbulence` noise filter (`wb-noise-v2-shared`, fractal noise,
  three octaves) is applied to geometry for a pencil texture.
- Text is moved into a `data-wb-text-no-noise` group so labels stay crisp.
- Arrowheads are drawn as two short jittered strokes rather than markers.

### Annotations are overlays that target a block

- **Highlight**: an absolutely positioned SVG over the text block, with a
  marker-shaped path (`fill="#FFC800"`, opacity 0.2) sized to the measured
  bounds of a text range and clipped with a `clipPath`.
- **Circle**: a wobbly hand-drawn ellipse, stroke `#06B2FC`, rendered with a
  `stroke-dasharray` / `stroke-dashoffset` mask so it animates on as if drawn.
  It is positioned by `translate` relative to the parent block, meaning the
  tool call named the block id and a text span, and the client measured where
  that span landed.

### Voice is a cascade, not speech-to-speech

- Captions are split into `captions__word--spoken` and `captions__word--upcoming`,
  which needs per-word timestamps from the TTS provider.
- Named tutors with voice samples ("Alfrenzo: energetic and fun", "Rubie:
  warm and friendly") and a "Change tutor" control.
- Speech recognition is limited to English, Spanish, French, German, Italian,
  and Portuguese, with a note to type in other languages. That is a separate
  STT service with a language allowlist.
- Tutor "Speech Speed" setting.

So the pipeline is STT, then a text model, then TTS with word alignment.
The avatar is an inline SVG whose eyes and mouth are animated with
`transform-box: fill-box` transforms while audio plays.

### Everything else on the page

- Next.js app router, Tailwind, next-intl for localisation.
- Supabase auth (Google provider) and Supabase Storage.
- Stripe and Paddle for billing, with a 7-day money-back paywall.
- A boards sidebar with rename, delete, and PDF download of the board.
- "Follow tutor" camera mode that pans to the block being written.
- Transcript panel, pause and resume, mute, text chat with file attachments
  (PDF, images, text), and link ingestion for lesson material.
- Reset lesson, end lesson with a stats modal (minutes, turns, concepts).

---

## Part B. Build plan

### Decisions (2026-10-17)

- Self-hosted, single user. You run it on your own machine. Anyone who clones
  the repo runs it for themselves. It is not a hosted product.
- Thinking runs on your Claude subscription through Claude Code headless mode,
  not an API key. Fable plans the lesson. The live tutor turn uses whatever
  model on your plan feels fast enough.
- Images come from a hosted API, generated in parallel while the tutor keeps
  talking. Default Gemini 2.5 Flash Image. gpt-image-1 behind a flag, promoted
  to default only if measured latency is acceptable (target under 10 s).
- Voice is a cascade: speech-to-text, text model, text-to-speech with word
  timings. Local engines by default, hosted ones optional.
- SQLite on disk. No Supabase, no auth, no paywall.


### Flow (how a lesson goes)

1. **Intake.** A text box plus file drop (PDF, images, text, links). The
   tutor reads what you gave it and asks, in voice and on the board, what you
   want covered, how deep, and what you already know. Two or three turns,
   conversational, not a form.
2. **Plan.** Fable turns the intake into a lesson plan. The plan is shown as
   a short outline block at the top of the board so you can see where you are.
3. **Teach a concept.** Text, diagram, picture, narration, in parallel.
4. **Socratic check.** After each concept the tutor asks a real question, not
   "is that clear". Your answer drives the next step:
   - right: a quick confirmation, move on;
   - partly right: a targeted follow-up block that fills the gap;
   - wrong or confused: a new explanation from a different angle, often a
     fresh diagram, written onto the board next to the original;
   - a tangent: follow it, then offer "want to come back to the plan?".
5. **Return to plan.** The outline block tracks progress. The tutor can
   always jump back to the next unfinished section, and so can you by
   clicking the outline.
6. **Wrap.** Summary block, two or three recap questions, board saved.

The tutor prompt enforces the rhythm: explain, ask, listen, adapt, return.

### Architecture

```
Browser (Next.js)
  Board renderer  <- block stream (websocket)
  Mic -> STT      -> transcript events
  Audio player    <- TTS audio + word timings
        |
Tutor server (Node, local)
  Session loop: transcript in -> brain -> {speech text, tool calls} out
  Tools: write_block, draw_svg, show_image, annotate, point_at, new_section
  Brain adapter:   claude-code-headless (default) | api-key | ollama
  Planner:         Fable via Claude Code -> lesson plan JSON
  Image adapter:   gemini-flash-image (default) | gpt-image-1 | flux-schnell
  Voice adapters:  STT faster-whisper | deepgram.  TTS kokoro | elevenlabs
  Context folding: summarise older turns so the live prompt stays small
  Persistence:     SQLite (boards, blocks, transcript, images on disk)
```

Every provider sits behind an adapter interface. Swapping is one file.

### 1. The board is a document, not a canvas

Block schema (JSON, persisted):

```ts
type Block =
  | { id: string; type: "html";  column: number; html: string }
  | { id: string; type: "svg";   column: number; svg: string; width: 300; height: 200 }
  | { id: string; type: "image"; column: number; url?: string; prompt: string; status: "pending" | "ready" | "failed" }
  | { id: string; type: "annotation"; target: string; kind: "highlight" | "circle" | "underline"; match: string; color?: string }
```

Client responsibilities:

- One world div with translate and scale. Wheel to zoom, drag or space-drag
  to pan, pinch on touch. Zoom-to-fit and zoom-to-100 controls.
- Column flow layout: fixed column x offsets, measured heights, fixed gap.
- Handwriting font stack via a CSS variable so it can change per language.
- Streaming reveal: html blocks render progressively as tokens arrive.
- KaTeX for inline and display math.
- Annotations: find the text range in the target block, measure its client
  rects, draw the overlay in the block's coordinate space, animate with
  `stroke-dashoffset`.
- Image placeholder: a soft animated dot cloud at 528 by 288 while
  `status` is pending, exactly as the real product does. Speech never waits
  for an image.
- "Follow tutor": pan to the newest block unless the user has moved the camera
  in the last few seconds.

### 2. SVG diagrams

Ask the text model for a clean SVG with a fixed viewBox, a small palette,
no gradients, no external fonts, text as `<text>` elements. Then on the
client:

1. Parse with DOMParser and sanitise (strip scripts, event handlers, external hrefs).
2. Convert `line`, `rect`, `polyline`, `polygon`, `circle`, `ellipse`, and
   `path` to roughened paths with rough.js (`roughness` around 0.8, `bowing`
   around 1).
3. Wrap geometry in a group with a shared `feTurbulence` filter.
4. Keep `<text>` in a separate, unfiltered group.

### 3. Images

Style suffix on every prompt for consistency:
"hand-drawn pencil sketch, soft watercolor wash, white background, labelled".

| Backend | Expected latency | Legible text in image | Cost |
|---|---|---|---|
| Gemini 2.5 Flash Image (default) | 5 to 10 s | Decent | Free tier at low volume |
| gpt-image-1 (flag) | 10 to 20 s | Best | About 4 to 8 cents at medium quality |
| Flux Schnell on fal.ai (flag) | 1 to 2 s | No | Under 1 cent |

Rules:

- Planner emits image prompts up front. Generation starts the moment the plan
  exists, before the tutor says a word.
- Runtime images (a question that needs a picture) fire on `show_image`,
  render a placeholder immediately, and fill in when ready.
- Images are the one piece that needs an API key even when self-hosting.
  There is no subscription path for image APIs.
- A `bench:images` script times each backend on five standard prompts so the
  default choice is measured, not guessed.

### 4. Brain: Claude Code headless

The tutor server keeps one long-running `claude -p` session per lesson,
using stream-json input and output so there is no cold start per turn.
Tools are exposed through an MCP server the tutor process hosts. That
bills to your Claude plan and is you using Claude Code on your own machine.

- Planning: Fable. One call, returns the lesson plan JSON below.
- Live turns: pick per plan. Opus 5.5 for quality, Sonnet 5.5 if turns feel slow.
- Rate limits: a 30-minute lesson is dozens of turns. Fine on Max, tight on Pro.
- `api-key` adapter uses the Claude API directly for anyone who prefers it.
- `ollama` adapter for a fully offline brain at lower quality.

Do not use the Agent SDK with subscription credentials. Anthropic documents
the SDK as API-billed. The CLI is the supported path.

### 5. Voice

| Stage | Local default | Hosted option |
|---|---|---|
| Speech-to-text | faster-whisper | Deepgram Nova |
| Text-to-speech | Kokoro | ElevenLabs or Cartesia (word timings built in) |

Interruption rules:

- On user speech start, stop audio, cancel the in-flight model stream, keep
  blocks already rendered, drop the rest.
- Truncate the assistant turn in the transcript at the last spoken word so the
  model knows what was heard.
- Pass the user's selected or pointed-at block id as context.

Captions: Kokoro gives phoneme timings, enough for spoken versus upcoming
word styling. Hosted TTS gives exact word timestamps.

### 6. Lesson planning

Before the session, one Fable call turns topic plus attachments into:

```json
{
  "title": "...",
  "sections": [
    { "goal": "...", "beats": ["..."], "blocks": [ ...Block ], "images": [ { "id": "...", "prompt": "..." } ] }
  ]
}
```

Image generation starts immediately. The plan is injected into the live
tutor's system prompt. The tutor teaches section by section and calls tools
as it goes. Questions extend the board with `write_block`.

Context folding: every N turns, summarise older transcript into a short
"so far" note and drop the raw turns, the way the real product's
`collapse-context` call does.

### 7. Persistence

SQLite with three tables: boards, blocks, turns. Images saved to
`data/images/<timestamp>-<block_id>.png`. Revisiting a board is reloading
the block list and transcript. Supabase is a later swap if anyone wants
multi-device sync.

### Stack

Next.js, React, TypeScript, Tailwind. rough.js, KaTeX. Node tutor service
on localhost. Claude Code headless for planning and tutoring. Gemini Flash
Image for pictures. faster-whisper and Kokoro for voice. SQLite.

### Build order

0. Repo scaffold, lint, test, `pnpm dev` starts both web and tutor server.
1. Block schema, board renderer (pan, zoom, columns, handwriting font,
   streaming reveal, KaTeX), SVG roughening, annotations, image placeholder.
   Driven by a fixture lesson with no network calls. Proves the look.
2. Brain adapter over Claude Code headless drives the board through tools.
   Typed chat only. Context folding.
3. Planner with Fable, image adapter with Gemini default, parallel
   pre-generation, `bench:images`.
4. Voice cascade with barge-in, captions, transcript truncation.
5. Board history, revisit, PDF export.
6. Polish: avatar, follow-tutor camera, settings, speech speed.

| Milestone | Solo dev with AI help |
|---|---|
| Phases 0 and 1 | one weekend |
| Through phase 3 | 2 to 3 weeks |
| Through phase 6 | 2 to 3 months |
| Running cost | Subscriptions you already have, plus cents per image |

### Keys needed

| Piece | Key | Free path |
|---|---|---|
| Brain | None (Claude plan via Claude Code) | Yes |
| Images | Gemini API key | Free tier |
| Voice | None with local engines | Yes |
| Storage | None | Yes |
