# OpenStudy: a voice whiteboard tutor you run yourself

A voice tutor that writes on a zoomable whiteboard, draws diagrams, generates
sketch images, can be interrupted, and leaves a board you can come back to.

This is the build plan: the decisions, the flow of a lesson, the
architecture, and the order the pieces were built in.

## Build plan

### Decisions (2026-10-17)

- The feature set is that of a commercial whiteboard tutor; the look is
  OpenStudy's own: graph paper, navy ink, coral and teal pens, Patrick Hand and Architects
  Daughter faces, a pencil-and-scribble image loader, a chat-history panel
  with board actions inline, a keypoints tracker. No avatar bubble, no dot
  cloud, no cream paper.
- The student always answers in their own words. No multiple choice.
- Highlighting is a highlighter: it can sweep any phrase in any text block
  and any region of a picture or diagram, timed to what the tutor is saying.

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

### Interactive models (Anatomy)

Three speeds of motion on the board:

| Need | Mechanism | Latency |
|---|---|---|
| A piston goes up and down while the tutor talks | `@motion`: animated SVG written by the tutor, shown as drawn | seconds |
| A real machine you can poke at | `@build_figure`: the Anatomy skill builds that real object through the CLI in the background, after the student approves; the model lands on the saved board | up to an hour |

Models are always built for the lesson that asked, never picked from a
library: neither the planner nor the tutor sees one. Built pages stay on the
machine that built them, in `figures/` (ignored by git).

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
  Brain adapter:   claude-code-headless (default) | codex-app-server | api-key | ollama
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
- Image placeholder: a quiet loading sketch at 528 by 288 while `status`
  is pending. Speech never waits for an image.
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
- `codex` adapter drives `codex app-server` on a ChatGPT plan: one process
  per lesson, base instructions in place of Codex's coding prompt, streamed
  deltas, real interrupt. The planner uses an ephemeral thread with a strict
  output schema. Figure builds stay on the `claude` CLI.
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
"so far" note and drop the raw turns.

### 7. Persistence

SQLite with three tables: boards, blocks, turns. Images saved to
`data/images/<timestamp>-<block_id>.png`. Revisiting a board is reloading
the block list and transcript. Supabase is a later swap if anyone wants
multi-device sync.

### Stack

Next.js, React, TypeScript, Tailwind. rough.js, KaTeX. Node tutor service
on localhost. Claude Code headless for planning and tutoring. Gemini Flash
Image for pictures. faster-whisper and Kokoro for voice. SQLite.

### Build order (phases 0 to 6 done)

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
| Brain | None (Claude plan via Claude Code, or ChatGPT plan via Codex) | Yes |
| Images | Gemini API key | Free tier |
| Voice | None with local engines | Yes |
| Storage | None | Yes |
