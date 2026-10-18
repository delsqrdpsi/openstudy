/**
 * Pure helpers for the hosted voice: reading Deepgram's live transcription
 * messages and turning streamed 16-bit PCM into audio samples.
 */
export type Transcript =
  | { kind: "interim"; text: string }
  | { kind: "final"; text: string; endOfSpeech: boolean }
  | { kind: "utterance_end" }
  | { kind: "speech_started" }
  | { kind: "other" };

/** One message from Deepgram's /listen socket, reduced to what the tutor needs. */
export function readTranscript(raw: string): Transcript {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { kind: "other" };
  }
  if (msg.type === "UtteranceEnd") return { kind: "utterance_end" };
  if (msg.type === "SpeechStarted") return { kind: "speech_started" };
  if (msg.type !== "Results") return { kind: "other" };
  const channel = msg.channel as { alternatives?: { transcript?: string }[] } | undefined;
  const text = (channel?.alternatives?.[0]?.transcript ?? "").trim();
  if (msg.is_final) return { kind: "final", text, endOfSpeech: msg.speech_final === true };
  return { kind: "interim", text };
}

/**
 * Little-endian 16-bit PCM to float samples. Returns the samples and the odd
 * trailing byte, if any, to prepend to the next chunk.
 */
export function pcm16ToFloat(bytes: Uint8Array): { samples: Float32Array<ArrayBuffer>; rest: Uint8Array<ArrayBuffer> } {
  const even = bytes.length - (bytes.length % 2);
  const samples = new Float32Array(even / 2);
  for (let i = 0; i < even; i += 2) {
    const v = bytes[i] | (bytes[i + 1] << 8);
    samples[i / 2] = (v >= 0x8000 ? v - 0x10000 : v) / 32768;
  }
  return { samples, rest: new Uint8Array(bytes.subarray(even)) };
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** The recorder format Deepgram can read from this browser, if any. */
export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  // Safari records only MP4 (AAC). Deepgram detects containers itself (the server sets no encoding),
  // and lists MP4/AAC among them; it comes last so browsers with WebM keep using it.
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}
