# OpenStudy

A whiteboard tutor you run yourself. It talks, writes on a zoomable board in
handwriting, draws sketched diagrams, shows pictures, asks you questions, and
adapts to your answers. Single user, local first, your own subscriptions and
keys.

The plan and the reasoning behind it are in [PLAN.md](PLAN.md).

## Status

- [x] Phase 0: workspace, lint, typecheck, unit and browser tests
- [x] Phase 1: the board. Blocks, column layout, pan and zoom, handwriting,
      streamed writing, KaTeX, sketched SVG, image placeholders, annotations,
      follow-tutor camera. Driven by a scripted fixture lesson, no network.
- [ ] Phase 2: a text model drives the board through tools (Claude Code headless)
- [ ] Phase 3: lesson planner, image generation in parallel
- [ ] Phase 4: voice with interruption
- [ ] Phase 5: saved boards, history, PDF export
- [ ] Phase 6: polish

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Open the fixture lesson from the home page. Scroll to pan, ctrl or cmd plus
scroll (or pinch) to zoom, drag on empty paper to pan, hold space to drag
anywhere.

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
apps/web          Next.js app: the board and the lesson UI
packages/shared   Block schema, lesson events, board reducer, column layout, fixtures
```
