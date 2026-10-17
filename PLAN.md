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

### Architecture

```
Browser (Next.js)
  Board renderer  <- block stream (websocket / SSE)
  Mic -> STT      -> transcript events
  Audio player    <- TTS audio + word timings
        |
Tutor server (Node)
  Session loop: transcript in -> text model -> {speech, tool calls} out
  Tools: write_block, draw_svg, show_image, annotate, point_at, new_section
  Planner: topic -> lesson plan JSON (sections, beats, blocks, image prompts)
  Image worker: prompt -> PNG -> storage
  Persistence: boards, blocks, transcripts
```

### 1. The board is a document, not a canvas

Block schema (JSON, persisted):

```ts
type Block =
  | { id: string; type: "html";  column: number; html: string }
  | { id: string; type: "svg";   column: number; svg: string; width: 300; height: 200 }
  | { id: string; type: "image"; column: number; url?: string; prompt: string; status: "pending" | "ready" }
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

Charts: let the model emit the same SVG. A chart spec with D3 is cleaner but
the DOM shows plain SVG works and keeps one code path.

### 3. Images

Style suffix on every prompt for consistency:
"hand-drawn pencil sketch, soft watercolor wash, white background, labelled".

| Model | Latency | Legible text in image |
|---|---|---|
| Flux Schnell (fal.ai) | 1 to 2 s | No |
| Gemini 2.5 Flash Image | 3 to 6 s | Decent |
| gpt-image-1 | 10 to 20 s | Yes |

Pre-generate during planning. Show a dashed placeholder sized 528 by 288
while a runtime image loads. Store in Supabase Storage (or local disk in
dev) keyed `<timestamp>-<block_id>.png`, exactly as the real product does.

### 4. Voice

Match the real product: a cascade.

- STT: Deepgram Nova (streaming, endpointing, language allowlist).
- Text model: Claude Sonnet 5.5 with tools for board actions. Opus 5.5 as an
  optional flag for planning depth.
- TTS: ElevenLabs or Cartesia, both return word timestamps for captions.
- Orchestration: LiveKit Agents or Pipecat, both handle barge-in.

Interruption rules:

- On user speech start, stop audio, cancel the in-flight model stream, keep
  blocks already rendered, drop the rest.
- Truncate the assistant turn in the transcript at the last spoken word so the
  model knows what was heard.
- Pass the user's selected or pointed-at block id as context.

Speech-to-speech (OpenAI Realtime, Gemini Live) remains a valid shortcut for
a prototype. It loses word-level captions and voice choice.

### 5. Lesson planning

Before the session, one planning call turns topic plus attachments into:

```json
{
  "title": "...",
  "sections": [
    { "goal": "...", "beats": ["..."], "blocks": [ ...Block ], "images": [ { "id": "...", "prompt": "..." } ] }
  ]
}
```

Image generation starts immediately. The plan is injected into the tutor
model's system prompt. The tutor teaches section by section and calls tools
as it goes. Questions extend the board with `write_block`.

### 6. Persistence

Day one: SQLite behind a small board API (boards, blocks, transcript turns).
Product: Supabase Postgres with the same API, plus Storage and auth.
Revisiting a board is reloading the block list and transcript.

### Stack

Next.js, React, TypeScript, Tailwind. rough.js, KaTeX. Node tutor service on
Fly or Railway. Claude for planning and board content. fal.ai for images.
Deepgram and ElevenLabs for voice. SQLite then Supabase.

### Build order

0. Repo scaffold, lint, test, CI.
1. Block schema, board renderer (pan, zoom, columns, handwriting font,
   streaming reveal, KaTeX), SVG roughening, annotation overlays. Driven by a
   fixture lesson with no network calls. Proves the look.
2. Text model drives the board through tools over a websocket. Typed chat only.
3. Planner, image pre-generation, placeholders, storage.
4. Voice cascade with barge-in, word-timed captions, transcript truncation.
5. Persistence, board history sidebar, revisit, PDF export.
6. Polish: avatar, follow-tutor camera, mobile, settings, speech speed.

| Milestone | Solo dev with AI help |
|---|---|
| Phases 0 and 1 | one weekend |
| Through phase 2 | 2 to 3 weeks |
| Through phase 6 | 2 to 3 months |
| Runtime cost per tutoring minute | about $0.10 to $0.30, mostly voice |

### Cost control while building

- Phases 0 to 2 need no paid keys: fixture lesson, then a Claude key only.
- Demo mode replays a fixture lesson with recorded audio and no network.
- Gemini free tier covers Live voice and Flash image at low volume.
- Local options with no keys: Whisper for STT, Kokoro for TTS.
- Consumer subscriptions (Claude plan, ChatGPT Plus) cover the coding tools,
  not the running app. The product must use API keys.
