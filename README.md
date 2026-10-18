# OpenStudy

A whiteboard tutor you run yourself. It talks, writes on a zoomable board in
handwriting, draws sketched diagrams, shows pictures, asks you questions, and
adapts to your answers. Single user, local first, your own subscriptions and
keys.

The plan and the reasoning behind it are in [PLAN.md](PLAN.md).

## Status

- [x] Phase 0: workspace, lint, typecheck, unit and browser tests
- [x] Phase 1: the board. Blocks, column layout, pan and zoom, handwriting,
      streamed writing, KaTeX, sketched SVG, image loader, highlighter, circle
      and underline annotations (on text, diagrams and pictures), follow camera
- [x] Phase 2: the tutor. Claude Code headless drives the board through a
      line protocol; intake, plan, teach, check, adapt; chat history panel;
      keypoints; typed interruption
- [x] Phase 3: Fable plans the lesson in parallel with the intake; pictures
      from Gemini, gpt-image-1 or Flux, generated ahead of time
- [x] Phase 4: voice in the browser. The tutor speaks, you talk back, talking
      over it stops it. No keys.
- [x] Phase 5: every lesson is saved (SQLite, no native deps); reopen a board
      from the home page and keep talking to the same tutor session
- [x] Phase 6 (part): PDFs and text files you attach are read in the browser;
      any board can be printed or saved as PDF
- [x] Interactive models: a figure library built with the Anatomy skill,
      shown on the board in sandboxed frames; animated `@motion` diagrams for
      live motion; "build me a model" jobs that run Anatomy in the background
- [x] Hosted voice: Deepgram Aura-2 and Nova behind the tutor server, barge-in kept
- [x] Canvas (part): connect to your school's Canvas with an access token,
      pull pages, assignments and files from a course into a lesson
- [ ] Next: image and scanned-PDF reading, source pages on the board

## Run it

You need the `claude` CLI logged in to your Claude plan. Nothing else is
required; pictures need an image key (see `.env.example`).

```bash
pnpm install
cp .env.example .env     # optional: image keys, models
pnpm dev                 # web on http://localhost:3000, tutor server on :8787
```

Type what you want to learn on the home page. The tutor asks a question or
two, plans, and starts. Answer in the box at the bottom or turn the mic on
(Chrome or Edge). Scroll to pan, ctrl or cmd plus scroll (or pinch) to zoom,
drag on empty paper to pan, hold space to drag anywhere.

The scripted demo lesson on the home page runs with no model at all.

`Connect to Canvas` under the text box pulls course material in: find your
school, then paste an access token from Canvas (Account → Settings →
Approved Integrations → New Access Token). The token is kept in the tutor
server's database on your machine and never sent to the browser. Pages,
assignments and files you pick become lesson materials, like dropped files.

## How it is put together

- The tutor writes a line protocol (`@say`, `@html ... @end`, `@svg`,
  `@image`, `@annotate`, `@ask`) that streams straight onto the board.
  See `packages/shared/src/protocol.ts`.
- The board is a document of blocks laid out in columns by the client. The
  model never places pixels. Diagrams are redrawn in a hand-drawn style with
  rough.js; pictures come from an image API; annotations are measured from
  text ranges or picture regions.
- The brain is the `claude` CLI in headless mode, one process per turn,
  resumed by session id. It bills to the Claude plan you are logged in with.
  The planner is a separate one-shot call on Fable with structured output.
- Voice: with `DEEPGRAM_API_KEY` set, the tutor speaks with Aura-2 and
  listens with Nova, streamed through the tutor server (`POST /tts`, `/stt`)
  so the key stays on your machine and audio starts within a few hundred
  milliseconds. Talking over the tutor stops it. Without a key, the browser's
  own speech synthesis and recognition are used (the mic then needs Chrome or
  Edge). The board keeps step with the voice either way.
- Interactive models come from `figures/` (see its README). Each is a
  self-contained page built with the Anatomy skill, shown in a sandboxed
  frame. The tutor places one with `@figure`, draws simple motion with
  `@motion` (animated SVG, seconds), and can request a new model with
  `@build_figure`, which runs the skill through the `claude` CLI in the
  background and adds the result to the saved board when it finishes
  (tens of minutes). Seed more examples with `pnpm figures:seed` after
  `npx skills add wheresryan22/anatomy -g -a claude-code`.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test                         # unit tests (shared package)
pnpm --filter @openstudy/web e2e  # browser tests, needs Playwright's Chromium
```

If a system Chromium should be used instead of Playwright's download, set
`CHROMIUM_PATH=/path/to/chrome`.

## Layout

```
apps/web          Next.js app: the board, the lesson UI, voice
apps/tutor        Tutor server: websocket, sessions, brain and image adapters, planner
packages/shared   Block schema, lesson events, protocol parser, board reducer, layout, fixtures
```
