# OpenStudy launch plan

The launch video, the social content, the tooling, and a handoff brief for the
build session. Everything here is grounded in what the repo does today
(README.md and PLAN.md); nothing promises a feature that is not shipped.

---

## 0. What we are launching, in one breath

**A tutor that talks and writes on a whiteboard while it teaches. It runs on
your laptop, on the Claude plan you already pay for, and the board is yours.**

Three facts carry the launch. Every piece of content should land at least one:

1. **It writes while it talks.** Handwriting streams onto graph paper, diagrams
   are sketched, pictures appear, phrases get highlighted and circled as the
   tutor says them. This is the thing people have not seen running locally.
2. **It is Socratic.** After each concept it asks a real question, you answer
   in your own words, and the next block depends on what you said. Wrong
   answers get a fresh diagram, not a retry button.
3. **It is yours.** `git clone`, `pnpm dev`, done. The brain is the `claude`
   CLI you are already logged into, so there is no API bill for thinking.
   Boards save to SQLite on disk. Nothing leaves your machine except the
   model calls you already make.

Secondary facts for threads and replies, not for the hero: voice with barge-in
(talk over it and it stops), interactive models in sandboxed frames, animated
motion diagrams, PDF attachments read in the browser, print any board to PDF,
switch the model mid-lesson, pictures from Gemini / gpt-image-1 / Flux.

### The Studdy angle

The repo exists because we reconstructed how Studdy works from its DOM
(`docs/studdy-reconstruction.md`, PLAN.md Part A). That is a strong
Hacker News and Reddit story ("I read a product's DOM and built an open
version") and a weak hero-video story (it makes us a clone). Rule: the hero
video and the Product Hunt page never mention Studdy. The HN post and one
thread tweet tell the reconstruction story, factually, with the doc linked.
Do not use their name in any title.

---

## 1. The launch video

### Format

| Cut | Length | Aspect | Where |
|---|---|---|---|
| Hero | 60 to 75 s | 16:9, 1920x1080 | X (native upload), YouTube, README, Product Hunt, LinkedIn |
| Vertical | 45 to 60 s | 9:16, 1080x1920 | YouTube Shorts, Reels, TikTok |
| Clips | 8 to 20 s each, five of them | 16:9 and 1:1 | Thread posts, replies, Bluesky, Threads |
| README GIF | 6 s loop, no audio | 16:9, 960 wide | top of README.md, repo social preview |

One source, many renders. See section 2 for why that is cheap here.

### Principles

- **No logo for the first 10 seconds.** Open on the board already being
  written on, with the tutor's voice already talking. Curiosity first.
- **Diegetic sound.** The lesson audio in the video is the tutor's real voice
  (Deepgram Aura-2, the same voice the product ships with). The pitch lines
  are on-screen text, not a voiceover, so the only voice you hear is the
  product's. If a founder voice is wanted, it is one line at the end.
- **Show the student's hand.** The adaptive turn only reads if we see the
  student type (or hear them say) a half-right answer and then watch the board
  respond. Do not skip the answer.
- **Real speed, briefly sped up.** Handwriting at real speed for the first
  beat so people believe it, then 1.5x to 2x for the montage, with a small
  "2x" tag in the corner. Never cut the writing mid-stroke.
- **Captions on everything.** Word-timed (Deepgram returns timings), rendered
  in the UI font, the way the product's own captions work.
- **End on the command.** The last frame is `git clone` ... `pnpm dev` and the
  repo URL. That is the call to action; there is no sign-up.

### Script and shot list (hero, 16:9)

Timings assume 30 fps. All lesson content comes from a new scripted fixture
(`launch` in `packages/shared/src/fixtures/`) written in the same style as
`rl101.ts`, so the whole thing renders with no model and is reproducible to
the frame. Topic for the lesson: **why the sky is blue** (Rayleigh
scattering). It is universally known, gives a great diagram (sunlight into a
prism of wavelengths), a great picture prompt (sunset over water), one clean
piece of math (scattering goes as 1/λ⁴), and an obvious Socratic question
with a famous half-right answer ("it reflects the ocean").

| t | Picture | Sound | On-screen text |
|---|---|---|---|
| 0:00 to 0:06 | Tight on the board. `<h1>Why is the sky blue?</h1>` being handwritten in Architects Daughter, caret moving, graph paper visible. Camera follows the writing. | Tutor voice: "Okay. Let's start with what sunlight actually is." | none |
| 0:06 to 0:14 | Pull back. A body-text block streams in (Patrick Hand). A sketched SVG of sunlight entering a prism and fanning into colors draws itself, rough.js wobble visible. | Voice continues over the writing. Pencil scratch, very quiet. | none |
| 0:14 to 0:18 | The highlighter sweeps across "shorter wavelengths" in the text as the voice says it. A coral circle draws itself around "blue" in the diagram label. | Voice: "...and the shorter wavelengths, the blue end, scatter far more." | Lower-third, Inter, small: **A tutor that writes while it talks.** |
| 0:18 to 0:24 | A picture block appears with the pencil-and-scribble loader, then fills with a watercolor sunset. | Voice: "Here is the same physics at sunset." | none |
| 0:24 to 0:34 | New section. The tutor writes a question block: "So why does the sky look blue and not violet, since violet is even shorter?" Pause. The student's answer appears in the input at the bottom, typed in real time: "because violet gets absorbed up high?" | Voice asks the question. Silence while the answer is typed. Keyboard clicks, quiet. | **It asks. You answer in your own words.** |
| 0:34 to 0:46 | The tutor writes a "Half right" block next to the question, then a fresh small diagram: a curve of our eye's sensitivity over wavelength, peaking in green-blue, with violet falling off. Circle annotation on the peak. | Voice: "Partly. Some violet is absorbed, but the bigger reason is your eyes..." | **Wrong turns get a new diagram, not a retry button.** |
| 0:46 to 0:52 | Cut to a 9-second wide shot of the whole board: title, three columns, outline block on the right with checkmarks ticking. Keypoints panel visible. | Music comes up slightly. Voice tails off. | **Every lesson leaves a board you can come back to.** |
| 0:52 to 1:00 | Terminal, dark, three lines typed: `git clone github.com/delsqrdpsi/openstudy`, `pnpm install`, `pnpm dev`. Then a browser opens on the home page. | Typing sound. | **Runs on your laptop. Thinks on the Claude plan you already have.** |
| 1:00 to 1:08 | End card on graph paper: the wordmark "OpenStudy" in Architects Daughter, navy ink, coral underline. Repo URL. | Music resolves. | **OpenStudy. Open source, self-hosted, yours.** `github.com/delsqrdpsi/openstudy` |

Vertical cut: same beats, drop 0:18 to 0:24 and 0:46 to 0:52, crop the board
to one column at a time, text moves to the top third.

### The five clips

Each clip is one fact, one shot, ready to post on its own with the copy from
section 3.

1. **Handwriting** (10 s): title and a paragraph streaming in, with KaTeX
   rendering `\frac{1}{\lambda^4}` inline. Silent version and voiced version.
2. **Annotate as it speaks** (12 s): highlight sweep plus circle, synced to
   the voice. This is the single most shareable clip.
3. **Socratic turn** (20 s): question, typed half-right answer, new diagram.
4. **Barge-in** (12 s): the tutor is mid-sentence, the mic waveform jumps as
   the student talks, the voice stops, the board stops writing, the tutor
   answers the interruption. This one is a real screen recording, not a
   render (see section 2), because the point is that it is live.
5. **Interactive model** (12 s): an Anatomy figure (the lever-balance or
   dial-indicator already in `figures/`) placed on the board, the cursor drags
   its slider and the model moves.

### Audio

- **Voice:** Deepgram Aura-2, model `aura-2-thalia-en`, the product default.
  One script (`apps/video/scripts/tts.ts`) sends every `say` line of the
  launch fixture to the existing tutor server `POST /tts` route, saves
  `say-<n>.mp3` plus the word timings as JSON. Remotion places each clip at
  its `at` time and drives captions from the timings. Deterministic, re-run
  any time the script changes.
- **Music:** one quiet instrumental, warm, no vocals, under the voice by at
  least 12 dB. Source from a library with a clear license for YouTube and
  social (Artlist, Epidemic Sound, or a CC0 track from Free Music Archive).
  Do not use a track whose license needs a per-platform claim.
- **Foley:** very quiet pencil-on-paper loop during handwriting, keyboard
  clicks during the typed answer. Optional. If it distracts, cut it.

---

## 2. Tooling: what to make it with

### Recommendation

**Remotion for the hero, the vertical cut, the clips, the GIF and the OG
image. One real screen recording (OBS or Screen Studio) for the barge-in clip
and for an unedited "it is actually live" post. Clueso only if we want a
narrated setup walkthrough later, and it is optional.**

### Why Remotion fits this repo unusually well

The board is a React component that takes a `state` prop
(`apps/web/src/board/Board.tsx`), and state is produced by a pure reducer
(`applyEvent`, `emptyBoard` in `packages/shared`) folded over a list of
timed events. The scripted demo already uses this with no model
(`usePlayer.ts`, `rl101.ts`). So for any frame `f`:

```
state(f) = events.filter(e => e.at <= f / fps * 1000).reduce(applyEvent, emptyBoard(title))
```

A Remotion composition renders `<Board state={state(frame)} follow />` with
the real fonts, the real rough.js sketching, the real KaTeX, the real
annotation layer. Nothing is faked and nothing is re-drawn by hand. Changing
one word in the script and re-rendering every format is one command. The
same composition at 1080x1920 is the vertical cut, at 960x540 with
`--codec gif` is the README loop, as a `<Still>` it is the OG image.

License: Remotion is free for individuals and companies with up to three
people, which covers this project. Check remotion.dev/license before a company
with more people picks it up.

### Things Remotion will trip on in this codebase, and the fix

Remotion renders each frame with the browser clock frozen, so anything that
animates on wall-clock time renders as a single still or flickers:

| What | Where | Fix in a `videoMode` wrapper |
|---|---|---|
| Camera pan transition | `globals.css` line ~74 (`transition: transform 220ms`) | Disable the transition in video mode and interpolate the camera with `interpolate(frame, ...)` from Remotion |
| Caret blink | `wb-blink` keyframes | Compute on/off from `frame % 27` |
| Picture loader scribble | `wb-scribble` keyframes, `stroke-dashoffset` | Set `stroke-dashoffset` from the frame |
| Annotation draw-on | `stroke-dashoffset` animation in the annotation layer | Same: offset from frames since the annotation's `at` |
| `@motion` diagrams | SMIL `<animateTransform>` inside the SVG | Either `svg.setCurrentTime(frame / fps)` on mount, or render the motion clip as a screen recording |
| Interactive figures | `<iframe>` to `figures/*/index.html` | Static frames are fine; the drag interaction is a screen recording |
| Streamed handwriting | already event-driven | works as is |
| Follow camera | `useViewport` uses `userMovedRecently` timers | Force follow on, no user input in video |

Plan for this: a `VIDEO_MODE` React context (or a class on `<html>`) that the
few animated pieces check. It is a small change to app code and makes the
board render deterministically; it also happens to make Playwright
screenshots stable, which the e2e suite will like.

### The alternatives, honestly

| Tool | What it is | Use it for | Why not for the hero |
|---|---|---|---|
| **Remotion** | Video as React code, rendered frame by frame in Chromium | Hero, vertical, clips, GIF, OG image | Setup cost of a day; the animation fixes above |
| **Clueso** | Upload a screen recording, it adds AI voice, zooms, cursor smoothing, captions, and writes a matching help article | A narrated "install and run OpenStudy in 3 minutes" walkthrough, docs clips | Not deterministic, voice is a generic AI narrator (ours should be the tutor), limited control over timing, paid (solo tier is reported around $40 per month billed annually; confirm on their site). We could not find a product called "Clueso Lite"; that may be the free tier, which reportedly caps at 1080p |
| **Screen Studio** (Mac) | Screen recorder with automatic cursor zoom and smooth motion | The barge-in clip, the figure-drag clip, raw "it is real" posts | Not a compositor; one-off license |
| **OBS** | Free raw capture with audio | Same as above, any OS | Raw output needs an editor |
| **Generative video** (Veo, Sora and the like) | Prompt to clip | Nothing here. Maybe a 3-second establishing shot of a desk if we must | It cannot show our UI, and a fake shot next to real UI reads as fake |
| **Avatar tools** (HeyGen and the like) | Talking head from text | Nothing | Off brand; we deliberately have no avatar |
| **CapCut / DaVinci Resolve** | Editors | Final trim, music ducking, if Remotion's audio mixing feels fiddly | Fine as a last step, not a source |

### Thumbnails, OG image, stills

Render from Remotion `<Still>` compositions so they match the video exactly.
If a painted hero image is wanted for YouTube, gpt-image-1 is already wired in
`apps/tutor` (the image adapter); prompt it in the product's own picture style
("hand-drawn pencil sketch, soft watercolor wash, white background").

---

## 3. Social content

Drafts, ready to edit. Keep the voice plain and specific. No exclamation
marks, no "excited to announce", no emoji strings. Every post links the repo.

### X / Twitter

**Single launch post** (paired with the hero video, native upload):

> I built a tutor that talks and writes on a whiteboard while it teaches.
> Handwriting, sketched diagrams, pictures, highlights timed to the voice. It
> asks you real questions and changes the lesson based on your answer.
>
> It runs on your laptop on the Claude plan you already have. Open source.
>
> github.com/delsqrdpsi/openstudy

**Launch thread** (post 1 is the single post above; each later post carries
one clip):

2. [clip 2: annotate] "The part I care most about: the highlighter and the
   circles land on the words as the tutor says them. The model never places a
   pixel. It names a block and a phrase, the client measures where the phrase
   landed and draws there."
3. [clip 3: Socratic] "After each concept it asks a question. You answer in
   your own words, no multiple choice. Half right gets a targeted follow-up.
   Wrong gets a new explanation from a different angle, usually with a fresh
   diagram next to the first one."
4. [clip 4: barge-in, real recording] "You can talk over it. It stops, the
   board stops, and it answers what you said. This clip is a raw screen
   recording, nothing rendered."
5. [clip 1: handwriting with KaTeX] "The board is a document, not a canvas.
   Blocks flow into columns, text is real DOM so it is selectable, math is
   KaTeX, diagrams are clean SVG from the model roughened on the client with
   rough.js. Zoom is one CSS transform."
6. [clip 5: figure] "Interactive models: self-contained HTML built with the
   Anatomy skill, shown in sandboxed frames. The tutor can place one, animate
   a simple motion in seconds, or kick off a build in the background that
   lands on your saved board later."
7. [screenshot: terminal] "How it thinks: the brain is the `claude` CLI in
   headless mode, one process per turn, resumed by session id. It bills to
   the Claude plan you are logged into. Pictures need an image key (Gemini
   free tier works). Voice is the browser's, or Deepgram if you add a key."
8. [screenshot: PLAN.md Part A] "It started as a reconstruction. I read the
   DOM of a commercial whiteboard tutor and wrote down how it must work:
   one transformed world div, client-side column layout, model-named block
   ids, SVG post-processed to look hand-drawn. Then built an open version
   with its own look. Notes in the repo."
9. "What is next: image and scanned-PDF reading, source pages on the board.
   If you try it, I want to see your boards. Repo: github.com/delsqrdpsi/openstudy"

### Hacker News (Show HN)

Title (under 80 characters, no marketing words):

> Show HN: OpenStudy – a self-hosted voice tutor that writes on a whiteboard

Text:

> OpenStudy is a tutor that talks and writes on a zoomable whiteboard while it
> teaches: streamed handwriting, sketched SVG diagrams, generated pictures,
> highlights and circles timed to the speech. After each concept it asks a
> question, you answer in your own words, and the next step depends on your
> answer.
>
> It runs locally. The brain is the `claude` CLI in headless mode driving the
> board through a small line protocol (`@say`, `@html`, `@svg`, `@image`,
> `@annotate`, `@ask`), so it bills to a Claude subscription rather than an
> API key. Boards persist to SQLite. Voice is a cascade (STT, text model, TTS
> with word timings) using the browser's engines by default or Deepgram with a
> key. Pictures need an image API key; everything else works without one.
>
> Some things that were interesting to build: the board is a document of
> blocks the client lays out in columns, so the model never emits
> coordinates; annotations target a block id and a phrase and the client
> measures where the phrase landed; diagrams are clean SVG from the model
> roughened with rough.js on the client; interruption truncates the
> transcript at the last word the student actually heard.
>
> It began as a reconstruction of how a commercial product's board works,
> from its DOM. That write-up is in the repo (docs/studdy-reconstruction.md
> and PLAN.md Part A) if you like reading page markup.
>
> There is a scripted demo lesson on the home page that runs with no model
> at all, so you can see the board before setting anything up.

Post Tuesday to Thursday, 8 to 10 am Eastern. Stay in the thread all day.

### Reddit

Each sub gets its own angle, not a copy. Read each sub's self-promotion rule
first; several require a text post rather than a link, and some require you
to have posted there before.

- **r/selfhosted** — "A whiteboard tutor you run yourself (Claude plan for
  the brain, SQLite for the boards, no accounts)". Lead with the no-account,
  on-disk, one-command angle. Mention what still calls out (model calls,
  image API, Deepgram if enabled).
- **r/ClaudeAI** — "I used Claude Code headless as the brain for a voice
  tutor that writes on a whiteboard". Lead with the stream-json session,
  the MCP tools, Fable planning and Sonnet/Opus teaching, model switch
  mid-lesson. This crowd will ask about rate limits; answer honestly (a
  30-minute lesson is dozens of turns, fine on Max, tight on Pro).
- **r/learnmachinelearning** or **r/explainlikeimfive** adjacent subs —
  share a finished board, not the product. "Asked my tutor to explain
  Rayleigh scattering, here is the board it left" with the PDF export.
  The product is the footnote.
- **r/LocalLLaMA** — only once the `ollama` adapter in PLAN.md section 4 is
  actually shipped. Until then, skip; they will ask immediately.

### LinkedIn

> Most AI tutors are a chat box. The good human tutors I had never taught
> from a chat box. They talked while they wrote, drew a picture when the words
> were not landing, and asked me a question before moving on.
>
> OpenStudy does that. It writes on a whiteboard in handwriting while it
> speaks, sketches diagrams, highlights the phrase it is saying, asks a real
> question after each idea, and changes the lesson based on your answer.
>
> It is open source and runs on your own machine using the Claude
> subscription you already have, so there is no API bill for the thinking and
> your boards never leave your disk.
>
> Video below. Repo in the first comment.

### YouTube

- **Title:** OpenStudy: an open-source tutor that writes on a whiteboard while it talks
- **Description:** two paragraphs from the HN text, then chapters, then the
  repo link, then the setup commands.
- **Chapters:** 0:00 The board, 0:14 Annotations timed to speech, 0:24 It
  asks, you answer, 0:46 Your saved board, 0:52 Run it yourself.
- **Shorts:** the vertical cut, title "A tutor that writes while it talks".
- **Later:** a 6 to 8 minute real lesson, unedited, screen recorded, with a
  real voice conversation. This will do more for trust than the hero.

### Product Hunt

- **Tagline (60 chars):** A whiteboard tutor that talks, draws and asks. Self-hosted.
- **Description:** the three facts from section 0, as three short paragraphs.
- **First comment (maker):** why it exists (the human tutor paragraph from
  LinkedIn), what it needs (Claude CLI logged in, optional image key), what
  it does not do yet (image and scanned-PDF reading), and the reconstruction
  story in one sentence with the doc linked.
- **Gallery:** hero video first, then five stills from the clips, then the
  terminal screenshot.
- Launch on a weekday, 12:01 am Pacific. Do not launch PH and HN the same
  day; HN first, PH two or three days later with HN feedback folded in.

### Bluesky and Threads

The single launch post, with clip 2 instead of the hero (short attention,
one striking thing). Reply to yourself with the repo link.

### Communities

- Anthropic's Claude Developers Discord, show-and-tell channel: the single
  post plus the Claude Code headless detail.
- Remotion's Discord, showcase channel, once the video exists: "the whole
  video is the product's own React board component rendered by Remotion",
  with the composition source linked. Their team reshares good showcases.
- The Anatomy skill's author (wheresryan22): a direct message with the figure
  clip before launch day. Their figures are in the video; they will likely
  share it.

---

## 4. Calendar

| Day | Do |
|---|---|
| T-10 | Write the `launch` fixture (sky-is-blue lesson). Record TTS. Build the Remotion package and video mode. First rough render. |
| T-7 | Record the barge-in clip and the figure clip for real (Screen Studio or OBS). Cut the hero to length. Pick music. |
| T-5 | README gets the GIF at the top, a "Run it" block within the first screen, and the hero video linked. Set the repo social preview image. Tag a release (`v0.1.0`) with notes. |
| T-4 | Dry run: fresh machine, clone, follow the README only. Fix every snag. Confirm the scripted demo runs with no keys and the error text is kind when the `claude` CLI is missing. |
| T-3 | Draft all posts in a file (this doc's section 3, edited). Schedule nothing; post by hand so you can reply. |
| T-2 | DM the Anatomy author and two or three people who will care. Ask for nothing. |
| T-0 (Tue, Wed or Thu) | 8 to 10 am Eastern: Show HN. 15 minutes later: X single post, then the thread over the next two hours. LinkedIn by noon. Bluesky, Threads. Discord channels. Stay in every thread. |
| T+1 | r/ClaudeAI and r/selfhosted (not the same morning as HN). YouTube long video goes live. Reply to every issue opened. |
| T+2 or T+3 | Product Hunt. Shorts and Reels go out. |
| T+5 | A "what people asked" post: the five most common questions and the fixes shipped since launch. |
| T+7 | The unedited real-lesson video on YouTube. |
| T+14 | Finished-board posts in learning subs. Tag a `v0.1.1` with the launch-week fixes. |

---

## 5. Asset checklist

- [ ] `launch` fixture: lesson script, diagrams as clean SVG, two picture
      prompts rendered once with gpt-image-1 and committed as PNG so the video
      never calls an image API
- [ ] TTS clips and word timings for every `say` line
- [ ] Hero 16:9, 1920x1080, H.264, under 50 MB for X
- [ ] Vertical 9:16, 1080x1920
- [ ] Five clips, each 16:9 and 1:1, with and without captions baked in
- [ ] README GIF, 960x540, under 8 MB, 6 s loop
- [ ] OG image 1280x640 for the repo social preview
- [ ] YouTube thumbnail 1280x720
- [ ] Product Hunt gallery stills (five) 1270x760
- [ ] Terminal screenshot of `pnpm dev` starting both servers
- [ ] A finished sky-is-blue board exported to PDF (for learning-sub posts)
- [ ] Release `v0.1.0` with notes that match README status
- [ ] Optional: a static deployment of just the scripted demo route
      (`/lesson/rl101`, and the new `/lesson/launch`), so "see it" needs no
      install. Check that the home page degrades cleanly when the tutor
      server is absent before doing this

---

## 6. Handoff brief for the build session

Paste this section to the model doing the work. It assumes the repo as of
this commit and the decisions above.

**Goal.** Add a Remotion package that renders the launch video, its cuts, the
five clips, the README GIF and the OG image from the real board component
driven by a new scripted lesson fixture. Add a video mode so the board renders
deterministically frame by frame. Add a script that generates the narration
audio through the existing tutor server. Do not change product behaviour
outside video mode.

**Tasks, in order.**

1. **Fixture.** `packages/shared/src/fixtures/launch.ts`, exported like
   `rl101`, registered in `apps/web/src/app/lesson/[id]/page.tsx` so
   `/lesson/launch` plays it in the browser. Follow the shot list in section 1
   of `docs/launch.md` to the second. Sky-is-blue lesson. Use the `Script`
   helper pattern from `rl101.ts`. Diagrams are clean SVG, 300x200 viewBox,
   palette navy `#1f2a37`, coral `#e4572e`, teal `#0f9d8a`. Pictures are
   committed PNGs under `apps/web/public/fixtures/launch/` (generate them
   once with the image adapter at medium quality, hand-pick, commit). Include
   the student's typed answer as an event if the event schema allows a
   transcript event; if not, add a minimal `student.say` event type to
   `events.ts` and render it in the chat panel, with a unit test in
   `board.test.ts`.
2. **Video mode.** A `VideoModeProvider` in `apps/web/src/board/` with a
   hook `useVideoFrame()` returning `{ frame, fps } | null`. In video mode:
   camera interpolates from frame (no CSS transition), caret, picture loader
   and annotation draw-on compute `stroke-dashoffset` and visibility from the
   frame, `@motion` SVGs call `setCurrentTime(frame / fps)` after mount,
   follow camera is forced on. Outside video mode nothing changes. Keep the
   diff small and local; the table in section 2 lists every spot.
3. **Remotion package.** `apps/video`, workspace package
   `@openstudy/video`, Remotion 4.x pinned. Compositions:
   `Hero169` (1920x1080, 30 fps), `Hero916` (1080x1920),
   `Clip` with props `{ name }` for the five clips at 1920x1080 and
   1080x1080, `ReadmeGif` (960x540, 6 s), `OgImage` and `YoutubeThumb` as
   `<Still>`. The board is rendered by importing `Board` from the web app
   (set up the Remotion webpack override for the Next.js path aliases, the
   `@fontsource` CSS imports and Tailwind). Pitch text uses Inter; wordmark
   uses Architects Daughter. Colors from `globals.css` tokens only.
4. **Narration.** `apps/video/scripts/tts.ts`: reads the `say` events of the
   fixture, posts each to the tutor server's `POST /tts` (needs
   `DEEPGRAM_API_KEY`), writes `apps/video/public/tts/<n>.mp3` and
   `<n>.json` with word timings. Compositions place each clip with
   `<Sequence from={msToFrames(at)}>` and render captions from the timings,
   spoken words in ink, upcoming words in `--ink-faint`. Commit the generated
   audio so renders need no key.
5. **Scripts.** Root `package.json`: `video:tts`, `video:preview`
   (Remotion Studio), `video:render` (renders every composition to
   `apps/video/out/`). Document them in `apps/video/README.md`.
6. **README.** GIF at the top, hero video linked under it, "Run it" visible
   without scrolling. Add `docs/launch.md` to the README's doc links.

**Acceptance.**

- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass; the e2e suite still passes
  and screenshots are unchanged outside video mode.
- `pnpm video:render` produces every file in the section 5 checklist that is
  a render, with no network access and no API key.
- Rendering the same composition twice gives byte-identical frames (spot
  check three frames with an image diff).
- The hero is between 60 and 75 seconds, captions match the audio within
  one frame, the first logo or wordmark appears after the 10-second mark,
  the last frame shows the repo URL and `pnpm dev`.
- `/lesson/launch` plays correctly in the browser with the normal wall-clock
  player, so the fixture doubles as a second scripted demo.

**Out of scope for that session.** Screen recordings (barge-in, figure drag),
music selection, posting anything, the static demo deployment.
