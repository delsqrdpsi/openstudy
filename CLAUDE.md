# Project rules

## Slack
- Never post to any Slack channel, group DM, or other person.
- The only allowed Slack recipient is the repository owner's own DM, and only when they ask.
- Reading and searching Slack is fine.

## Plan
- The product plan lives in PLAN.md: decisions, lesson flow, architecture, build order.
- How the code is put together today lives in ARCHITECTURE.md, with diagrams.
  Update it in the same change whenever a package, adapter, wire message,
  table or data path is added, moved or removed.

## Branches
- Name branches `<type>/<short-kebab-summary>`, lower case, two to five words:
  `feat/board-history-search`, `fix/tts-cuts-last-word`, `docs/architecture`.
- Types: `feat` (something a student can see or do), `fix` (a bug),
  `refactor` (same behaviour, better code), `perf`, `test`, `docs`,
  `chore` (deps, tooling, config).
- One branch, one change. Do not mix a feature with an unrelated refactor.
- Branch off `main` and keep it current by merging `main` in. Never force-push
  a branch someone else is working on.
- Claude Code cloud sessions get an auto-assigned branch (`claude/<random-name>`)
  and must push there. Make the PR title carry the convention instead:
  `feat: board history search`.
- Delete a branch once its PR is merged.

## Commits and pull requests
- Commit subject: `Area: what changed, in plain words`, present tense, no
  trailing period, under about 72 characters. The area is the part of the
  product a user would name: `Board`, `Pacer`, `Voice`, `Planner`, `Tutor`,
  `Sources`, `Figures`, `Lesson`, `README`.
  Example: `Pacer: the voice waits for the picture it is about to talk about`.
- The body, when needed, says why, not what the diff already shows.
- Small, focused commits. Each commit should typecheck and pass tests.
- Never commit `.env`, keys, `data/`, or generated build output.
- A PR says what changed, why, how it was checked, and links any issue.

## Before pushing
Run these from the repo root and fix anything they report:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @openstudy/web e2e   # when the board or lesson UI changed
```

## Tests
- Unit tests use Vitest and sit next to the code they test as `name.test.ts`
  (see `packages/shared/src/protocol.test.ts`, `apps/web/src/board/pacer.test.ts`).
- Every bug fix comes with a test that fails before the fix and passes after.
- Every new parser rule, reducer case, layout rule, wire message or store
  method gets unit tests, including the bad-input and edge cases.
- Put logic in plain functions and classes, not in React components or
  request handlers, so it can be tested without a browser or a server.
  Components and handlers stay thin.
- Tests never touch the network, a real model, a real API key, or the real
  `data/` directory. Use fakes that implement the adapter interfaces
  (`Brain`, `ImageBackend`), the fixture lesson in
  `packages/shared/src/fixtures/`, and `new Store(":memory:")`.
- Tests are deterministic: no sleeps, no wall-clock races; inject time and
  randomness where they matter.
- Browser behaviour that only shows in a real page (pan, zoom, layout,
  annotations landing on words) goes in a Playwright spec in `apps/web/e2e/`,
  driven by the fixture lesson.
- Never skip, delete or loosen a failing test to get green. Fix the cause.

## Architecture rules
See ARCHITECTURE.md for the picture. The rules that keep it scalable:

- **Dependency direction.** `apps/web` and `apps/tutor` depend on
  `packages/shared`; `shared` depends on neither, and the two apps never
  import each other. `shared` stays free of Node and DOM APIs so both sides
  can run it.
- **One contract.** Anything that crosses the websocket or HTTP boundary is a
  Zod schema in `packages/shared` (`wire.ts`, `events.ts`, `blocks.ts`) and is
  parsed with it on arrival. Never hand-roll a message shape on one side.
- **Adapters for every provider.** Models, images and voice sit behind an
  interface (`Brain`, `ImageBackend`, the voice module) with one factory that
  picks the implementation from an env var. Adding a provider is one new file
  plus one `case`; nothing else in the code learns its name.
- **The model never places pixels.** The tutor writes the line protocol;
  the shared parser turns it into events; the shared reducer turns events
  into board state; the client lays it out. Keep each step pure and in its
  own module.
- **Speech never waits on slow work.** Images, figure builds and planning run
  in parallel and fill in later. Every long call takes an `AbortSignal` so a
  barge-in can cancel it.
- **Fail small.** One failed picture, model call or voice request is logged
  and shown in that lesson; it never crashes the server or another lesson.
- **Keys stay on the tutor server.** The browser never sees an API key; it
  asks the tutor server, which calls the provider (`/tts`, `/stt`, and image
  generation inside the session).
- **Data is append-only and migrations are additive.** Lessons are a log of
  events; schema changes add columns or tables with a guarded `alter table`,
  so old boards always reopen.
- **State lives in a `Session`, not in module globals.** New per-lesson state
  goes on the session object. Existing globals (the active usage meter, the
  figure job map) are single-user shortcuts; do not add more.
- **Config comes from env with a default**, documented in `.env.example` and
  the README key table in the same change.
- Prefer small modules with one job. When a file passes about 400 lines,
  split it by responsibility before adding more.

## Code style
- TypeScript strict mode, no `any`, no non-null assertions to silence errors.
- Match the surrounding code: naming, comment density, file layout.
- Comments explain why, not what. A short doc comment on every exported
  function, class and interface.
- No new dependency without a reason in the commit body; prefer the platform
  (Node built-ins, browser APIs) when it is enough.
