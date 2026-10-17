import { WebSocket } from "ws";
import { log } from "../log";

/**
 * Hosted voice through Deepgram, kept behind the tutor server so the key
 * never reaches the browser. Aura-2 speaks the tutor's lines as a stream of
 * raw 16-bit PCM the client plays as it arrives; Nova transcribes the
 * student's microphone over a websocket the client reaches through /stt.
 */
export const TTS_MODEL = process.env.DEEPGRAM_TTS_MODEL ?? "aura-2-thalia-en";
export const STT_MODEL = process.env.DEEPGRAM_STT_MODEL ?? "nova-3";
export const SAMPLE_RATE = 24000;
/** Aura takes up to 2000 characters per request; tutor lines are far shorter. */
const MAX_TEXT = 2000;

export type VoiceConfig = { provider: "browser" } | { provider: "deepgram"; tts: string; stt: string; sampleRate: number };

function key(): string | null {
  const k = process.env.DEEPGRAM_API_KEY?.trim();
  return k ? k : null;
}

/** What the browser should use. VOICE=browser forces the built-in voice even with a key. */
export function voiceConfig(): VoiceConfig {
  const want = process.env.VOICE ?? "deepgram";
  if (want === "deepgram" && key()) return { provider: "deepgram", tts: TTS_MODEL, stt: STT_MODEL, sampleRate: SAMPLE_RATE };
  return { provider: "browser" };
}

/** Start Aura-2 on one line. The response body streams linear16 PCM at SAMPLE_RATE, mono. */
export async function speak(text: string, signal?: AbortSignal): Promise<Response> {
  const k = key();
  if (!k) throw new VoiceError(503, "DEEPGRAM_API_KEY is not set");
  const line = text.trim().slice(0, MAX_TEXT);
  if (!line) throw new VoiceError(400, "nothing to say");
  const url = new URL("https://api.deepgram.com/v1/speak");
  url.searchParams.set("model", TTS_MODEL);
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", String(SAMPLE_RATE));
  url.searchParams.set("container", "none");
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Token ${k}`, "content-type": "application/json" },
    body: JSON.stringify({ text: line }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new VoiceError(res.status === 401 || res.status === 403 ? 502 : 502, `deepgram speak ${res.status}: ${detail || res.statusText}`);
  }
  return res;
}

export class VoiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Bridge a browser socket to Deepgram live transcription. Binary frames from
 * the browser (MediaRecorder chunks) go up; Deepgram's JSON results come
 * back down unchanged. Audio that arrives before the upstream is open is
 * held, since the first chunk carries the container header.
 */
export function bridgeTranscription(client: WebSocket, params: URLSearchParams) {
  const k = key();
  if (!k) {
    client.close(1011, "DEEPGRAM_API_KEY is not set");
    return;
  }
  const url = new URL("wss://api.deepgram.com/v1/listen");
  url.searchParams.set("model", STT_MODEL);
  url.searchParams.set("language", params.get("language") ?? "en");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("endpointing", "300");
  url.searchParams.set("utterance_end_ms", "1200");
  url.searchParams.set("vad_events", "true");
  const up = new WebSocket(url, { headers: { Authorization: `Token ${k}` } });
  const held: Buffer[] = [];
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (keepalive) clearInterval(keepalive);
    keepalive = null;
  };

  up.on("open", () => {
    log.info("stt bridge open");
    for (const b of held) up.send(b);
    held.length = 0;
    keepalive = setInterval(() => {
      if (up.readyState === WebSocket.OPEN) up.send(JSON.stringify({ type: "KeepAlive" }));
    }, 5000);
  });
  up.on("message", (data, isBinary) => {
    if (isBinary || client.readyState !== WebSocket.OPEN) return;
    client.send(data.toString());
  });
  up.on("close", (code, reason) => {
    stop();
    if (client.readyState === WebSocket.OPEN) client.close(1000, reason.toString().slice(0, 100) || `deepgram closed ${code}`);
  });
  up.on("error", (err) => {
    log.warn("deepgram stt:", err.message);
    stop();
    if (client.readyState === WebSocket.OPEN) client.close(1011, "deepgram error");
  });

  client.on("message", (data, isBinary) => {
    if (!isBinary) return; // the browser only sends audio
    const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (up.readyState === WebSocket.OPEN) up.send(buf);
    else if (up.readyState === WebSocket.CONNECTING) held.push(buf);
  });
  client.on("close", () => {
    stop();
    log.info("stt bridge closed");
    if (up.readyState === WebSocket.OPEN) {
      up.send(JSON.stringify({ type: "CloseStream" }));
      up.close();
    } else up.terminate();
  });
}
