# @openstudy/web

The OpenStudy web app: the home page (topic, attachments, course folders,
saved boards), the live lesson (board, voice, chat history, keypoints), the
scripted demo, and the print view of a saved board.

Run it from the repository root with `pnpm dev`, which starts this app on
http://localhost:3000 and the tutor server on :8787. On its own:

```bash
pnpm --filter @openstudy/web dev        # next dev
pnpm --filter @openstudy/web test       # unit tests (vitest)
pnpm --filter @openstudy/web e2e        # browser tests (Playwright)
```

Where things are:

```
src/app/            pages: home, live lesson, saved lesson, print
src/board/          the board, layout, camera, pacing, voice, live session
src/board/blocks/   one component per block type, plus annotations
src/lib/            sanitizing html and svg, sketching diagrams, reading PDFs
public/vendor/      the pdf.js worker (must match the pinned pdfjs-dist)
e2e/                Playwright tests
```

`NEXT_PUBLIC_TUTOR_HTTP` and `NEXT_PUBLIC_TUTOR_WS` point the app at a tutor
server other than http://localhost:8787. See the root README for the rest.
