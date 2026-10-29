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
- [x] Interactive models: ask for the anatomy of a device and the tutor builds
      that real object with the Anatomy skill in the background, shown on the
      board in a sandboxed frame; animated `@motion` diagrams for live motion
- [x] Hosted voice: Deepgram Aura-2 and Nova behind the tutor server, barge-in kept
- [x] Teach from a folder: point it at your course slides, PDFs and
      screenshots; pages come onto the board as pictures and the tutor marks
      on their words (text layer from pdf.js, local OCR for scans and images)

## Run it

You need Node 22.13 or newer, pnpm, and the `claude` CLI logged in to your Claude plan
(`claude` once in a terminal, then sign in). That is the only hard
requirement: the tutor and the planner bill to that plan, not to an API key.
To run on a ChatGPT plan instead, install the Codex CLI
(`npm i -g @openai/codex`), run `codex login`, and set `BRAIN=codex`.

```bash
pnpm install
cp .env.example .env     # add keys here, see the next section
pnpm setup:anatomy       # optional: lets the tutor build interactive models
pnpm dev                 # web on http://localhost:3000, tutor server on :8787
```

`pnpm setup:anatomy` installs the [Anatomy](https://github.com/wheresryan22/anatomy)
skill for the `claude` CLI (into `~/.claude/skills`). Without it lessons
still work, with labelled pictures instead of interactive models. The tutor
server's first lines say whether model builds are on.

Type what you want to learn on the home page, or point it at a folder of
slides and PDFs with "Look inside". The tutor asks a question or two, plans,
and starts. Answer in the box at the bottom or turn the mic on. Say or type
"wait" to hold the lesson where it is, "slow down" to have the tutor take
smaller steps from then on, and "go on" when you are ready; the pause button
(Shift+Space) and the speed control do the same by hand. Scroll to
pan, ctrl or cmd plus scroll (or pinch) to zoom, drag on empty paper to pan,
hold space to drag anywhere.

The scripted demo lesson on the home page runs with no model at all.

## Keys

Put them in `.env` at the repo root (the tutor server loads it) or export
them in your shell. The file never leaves your machine; the browser talks to
the tutor server, which holds the keys.

| Key | What it unlocks | Needed? | Where to get it |
| --- | --- | --- | --- |
| Claude login (no key) | The tutor, the planner, "build me a model" jobs | Yes, unless `BRAIN=codex` | `claude` CLI, sign in with your Claude account |
| ChatGPT login (no key) | The tutor and the planner with `BRAIN=codex` | Alternative | `codex login` after `npm i -g @openai/codex`; Plus, Pro, Business or Enterprise plan |
| `GEMINI_API_KEY` | Pictures on the board (Gemini 2.5 Flash Image, the default) | For pictures | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `OPENAI_API_KEY` | Pictures with gpt-image-1 instead (`IMAGES=openai`) | Alternative | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `FAL_KEY` | Pictures with Flux instead (`IMAGES=fal`) | Alternative | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) |
| `DEEPGRAM_API_KEY` | Hosted voice: Aura-2 speech and Nova listening, fast and any browser | Recommended | [console.deepgram.com](https://console.deepgram.com) |

Without any key the lesson still runs: diagrams are drawn as SVG, pictures
are skipped, and the browser's own speech synthesis and recognition are used
(the mic then needs Chrome or Edge). Set one image key and one voice key for
the full experience. Models, persona, ports and storage paths are also in
`.env.example`, each with its default.

Rough running costs, shown live in the small ring at the top of a lesson:
the Claude plan covers the tutor; a picture is about a cent or two; an hour
of Deepgram voice is under a dollar.

## How it is put together

Diagrams and the rules that keep the code easy to grow are in
[ARCHITECTURE.md](ARCHITECTURE.md).

- The tutor writes a line protocol (`@say`, `@html ... @end`, `@svg`,
  `@image`, `@annotate`, `@continue`, `@wait`, `@ask`) that streams straight
  onto the board. See `packages/shared/src/protocol.ts`. After a picture, a
  diagram or a dense block the tutor stops (`@wait`) until you say go on;
  between plain steps the page rests for as long as the board takes to read.
- The board is a document of blocks laid out in columns by the client. The
  model never places pixels. Diagrams are redrawn in a hand-drawn style with
  rough.js; pictures come from an image API; annotations are measured from
  text ranges or picture regions.
- The brain is the `claude` CLI in headless mode, one process per turn,
  resumed by session id. It bills to the Claude plan you are logged in with.
  The planner is a separate one-shot call on Fable with structured output.
- With `BRAIN=codex` the brain is `codex app-server` instead: one process per
  lesson, one Codex thread per board, streamed token by token, billed to the
  ChatGPT plan. The model menu lists what Codex offers your plan. The usage
  ring shows tokens and context but no dollar figure (Codex reports none).
  "Build me a model" jobs still run through the `claude` CLI.
- Voice: with `DEEPGRAM_API_KEY` set, the tutor speaks with Aura-2 and
  listens with Nova, streamed through the tutor server (`POST /tts`, `/stt`)
  so the key stays on your machine and audio starts within a few hundred
  milliseconds. Talking over the tutor stops it. Without a key, the browser's
  own speech synthesis and recognition are used (the mic then needs Chrome or
  Edge). The board keeps step with the voice either way.
- Sources: a folder you point at is scanned for PDFs, decks (pptx, odp, key,
  converted with LibreOffice when installed), images and text. Pages are
  rendered to pictures with word boxes from the PDF text layer; scans and
  screenshots get boxes from local OCR (tesseract, no key, no network). The
  tutor places a page with `@page` and marks on it with `@annotate`.
- Interactive models are generated for the lesson, never picked from a
  library. When you ask for the anatomy of a device, its insides or an
  interactive model, the tutor offers to build that real object with
  `@build_figure`, and draws a labelled picture of it at once to teach from.
  You see the exact request and approve it first, because the build runs the
  Anatomy skill through the `claude` CLI with tools on your machine; the
  model lands on the board when it finishes (up to an hour). Built pages are
  kept in `figures/` on your machine (git ignores them) and served in a
  sandboxed frame. Simple motion is drawn
  with `@motion` (animated SVG, seconds).
- Recovery: each lesson keeps its own `claude` session. If that session is
  gone (deleted, expired, another machine), the tutor starts a fresh one and
  hands it the saved board and transcript, so the lesson carries on. A dropped
  connection reconnects by itself, and opening a board in a second tab hands
  the lesson to that tab.
- Safety: the tutor server listens on this machine only and answers only the
  OpenStudy web app running here, so other websites you visit cannot drive a
  lesson, read your folders or spend your keys. It reads course material only
  under your home folder unless you set `SOURCES_ROOT`. See the network
  section of `.env.example` to use a tablet on a trusted network. Everything
  the model writes is treated as untrusted: board HTML and SVG are sanitised,
  and every page carries a nonce-based Content-Security-Policy, so a
  sanitiser gap still cannot run script.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test                         # unit tests: parser, board, session, server guard, client logic
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

## License

OpenStudy is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md):
you may use, change and share it for any noncommercial purpose, such as
personal study, research, hobby projects, teaching, and use by charities,
schools and public institutions. Commercial use, including selling it or
offering it as a paid product or service, is not permitted. For a commercial
license, contact [@delsqrdpsi](https://github.com/delsqrdpsi).

Interactive models you build locally contain code from the Anatomy project,
which stays under the MIT License; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
