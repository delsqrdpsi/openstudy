# Architecture

How OpenStudy is put together today. PLAN.md holds the decisions and the
build order; this file holds the shape of the running code. Diagrams are
Mermaid, which GitHub renders in place.

## The pieces

```mermaid
flowchart LR
  subgraph Browser["Browser · apps/web (Next.js)"]
    Home["Home page<br/>topic, files, folder, saved boards"]
    Live["useLiveSession<br/>websocket client"]
    Pacer["Pacer<br/>keeps the board in step with the voice"]
    Board["Board renderer<br/>columns, pan and zoom, KaTeX,<br/>rough.js diagrams, annotations"]
    VoiceUI["Voice<br/>Deepgram stream or browser speech"]
  end

  subgraph Shared["packages/shared"]
    Schemas["Zod schemas<br/>blocks, events, wire messages"]
    Parser["Protocol parser<br/>@say @html @svg @image @annotate ..."]
    Reducer["Board reducer<br/>applyEvent"]
    Layout["Layout"]
  end

  subgraph Tutor["Tutor server · apps/tutor (Node, :8787)"]
    WS["/ws lesson socket"]
    HTTP["HTTP: /boards /sources /figures<br/>/images /tts /voice /health"]
    STT["/stt mic socket"]
    Session["Session<br/>one per lesson"]
    Planner["Planner"]
    BrainF["Brain adapter"]
    ImagesF["Image adapter"]
    VoiceS["Voice: Deepgram"]
    Sources["Sources<br/>pdf.js, LibreOffice, tesseract OCR"]
    Figures["Figures<br/>library + background builder"]
    Store[("SQLite<br/>boards + event log")]
    Disk[("data/<br/>images, source pages")]
  end

  subgraph External["Outside the machine"]
    Claude["claude CLI<br/>your Claude plan"]
    ImgAPI["Gemini / OpenAI / fal"]
    DG["Deepgram"]
  end

  Home --> Live
  Live <-->|"ClientMessage / ServerMessage"| WS
  Live --> Pacer --> Board
  Pacer --> VoiceUI
  VoiceUI -->|"POST /tts"| HTTP
  VoiceUI <-->|"PCM audio, transcripts"| STT
  Home -->|"scan folder, list boards"| HTTP

  WS --> Session
  Session --> BrainF --> Claude
  Session --> Planner --> Claude
  Session --> ImagesF --> ImgAPI
  Session --> Sources
  Session --> Figures --> Claude
  Session --> Store
  ImagesF --> Disk
  Sources --> Disk
  HTTP --> VoiceS --> DG
  STT --> VoiceS

  Browser -.->|imports| Shared
  Tutor -.->|imports| Shared
```

| Part | Where | Job |
|---|---|---|
| Web app | `apps/web` | Home page, lesson view, board rendering, voice in and out, print view |
| Tutor server | `apps/tutor` | One HTTP + websocket server. Runs lessons, holds keys, talks to every provider |
| Shared | `packages/shared` | The contract both sides agree on: schemas, the line-protocol parser, the board reducer, layout, the fixture lesson |
| Figures | `figures/` | Self-contained interactive HTML models, served by the tutor and shown in sandboxed frames |

## One teaching turn

```mermaid
sequenceDiagram
  autonumber
  actor S as Student
  participant W as Browser (useLiveSession + Pacer)
  participant T as Tutor Session
  participant B as Brain (claude -p --resume)
  participant I as Image backend
  participant DB as SQLite

  S->>W: types or speaks an answer
  W->>T: {type: "user", text}
  T->>DB: append user entry
  T->>B: turn(system prompt + plan, text, AbortSignal)
  loop streamed text
    B-->>T: text delta
    T->>T: ProtocolParser turns lines into LessonEvents
    T->>T: applyEvent on the server copy of the board
    T->>DB: append event
    T-->>W: {type: "event", event}
    opt @image
      T->>I: generate(prompt) in parallel
      I-->>T: url (later)
      T-->>W: image.update event
    end
  end
  T-->>W: {type: "turn", state: "waiting"}
  W->>W: Pacer releases blocks as each line is spoken
  Note over S,W: Talking over the tutor sends {type: "interrupt", heard}.<br/>The server aborts the brain process and keeps only what was heard.
```

The planner runs once per lesson, in parallel with the intake turns. Its
plan (sections, beats, picture prompts) is folded into the tutor's system
prompt, and its pictures start generating before the tutor needs them.

## Data flow inside the board

```mermaid
flowchart LR
  Text["model text<br/>(line protocol)"] --> Parser["ProtocolParser"]
  Parser --> Events["LessonEvent[]"]
  Events --> Reducer["applyEvent"]
  Reducer --> State["BoardState<br/>blocks + annotations"]
  State --> Layout["layout<br/>columns, heights"]
  Layout --> DOM["React board"]
  Events --> Log[("event log<br/>SQLite")]
  Log -->|"reopen a board"| Reducer
```

Every step is a pure function in `packages/shared`, which is why the same
code runs on the server (to keep a copy and save it), in the browser (to
render) and in unit tests (with the fixture lesson). Reopening a board is
replaying its log through the same reducer.

## Adapters

Every outside service sits behind an interface and a factory chosen by env.

| Seam | Interface | Factory | Today | Env |
|---|---|---|---|---|
| Thinking | `Brain` (`apps/tutor/src/brain/types.ts`) | `createBrain` | `claude-code` | `BRAIN`, `TUTOR_MODEL` |
| Pictures | `ImageBackend` (`apps/tutor/src/images/types.ts`) | `createImages` | `gemini`, `openai`, `fal`, `none` | `IMAGES` + key |
| Voice | `voiceConfig`, `speak`, `bridgeTranscription` (`apps/tutor/src/voice/deepgram.ts`) | `voiceConfig` | Deepgram, or browser speech when no key | `VOICE`, `DEEPGRAM_API_KEY` |
| Storage | `Store` (`apps/tutor/src/store.ts`) | constructor | SQLite via `node:sqlite` | `DATA_DIR` |

Adding a provider is one file implementing the interface and one `case` in
the factory. The session never names a provider.

## Storage

```mermaid
erDiagram
  boards ||--o{ log : has
  boards {
    text id PK
    text title
    text topic
    text brain
    text model
    text brain_session_id "resumes the CLI conversation"
    text plan_json
    text usage_json
    text sources_json
    int created_at
    int updated_at
  }
  log {
    text board_id FK
    int seq PK
    text kind "event | user"
    text json
  }
```

Files under `data/` (or `DATA_DIR`): `openstudy.db`, generated images,
rendered source pages, and the brain's working directory (the `claude` CLI
files its sessions there, so it must stay put for resumes to work).

## Wire contract

All messages are Zod schemas in `packages/shared/src/wire.ts` and are
parsed on arrival on both sides.

- Client to server: `start` (new topic or `resume` a board), `user`,
  `interrupt` (with how many lines were heard), `continue`, `model`.
- Server to client: `session`, `history`, `event`, `turn`, `usage`,
  `error`, `debug`.

Changing a message means changing the schema in `shared`; both apps then
fail typecheck until they agree.

## Scaling: what holds and what does not

OpenStudy is single user and local first by decision (PLAN.md). The code is
shaped so that growing it is a matter of swapping pieces, not rewriting.

What already scales:

- **New providers** drop in behind the adapters without touching the session.
- **New block types and protocol verbs** are one schema, one parser rule,
  one reducer case and one renderer component, each testable alone.
- **Long work is parallel and cancellable**: images, planning and figure
  builds never block speech, and every call takes an `AbortSignal`.
- **Lessons are an append-only log**, so history, replay, export and sync
  can all be built from the same rows.

Single-user assumptions to remove before more than one person uses a server:

| Assumption | Where | Way out |
|---|---|---|
| One active usage meter for voice | `apps/tutor/src/usage.ts` (`activeMeter`) | Pass the meter with the request, or key voice sockets by session |
| Figure build jobs in a module map | `apps/tutor/src/figures/builder.ts` | Move jobs to the store, or a queue |
| SQLite on local disk | `apps/tutor/src/store.ts` | Same `Store` interface over Postgres or Supabase |
| Open CORS, no auth | `apps/tutor/src/index.ts` | Bind to localhost only, or add auth before exposing it |
| Brain bills to one Claude login | `apps/tutor/src/brain/claudeCode.ts` | An API-key `Brain` adapter per user |
