import { describe, expect, it } from "vitest";
import { concatBytes, pcm16ToFloat, readTranscript } from "./deepgram";

describe("readTranscript", () => {
  it("reads interim and final results", () => {
    const interim = JSON.stringify({ type: "Results", is_final: false, channel: { alternatives: [{ transcript: "hello the" }] } });
    expect(readTranscript(interim)).toEqual({ kind: "interim", text: "hello the" });
    const final = JSON.stringify({ type: "Results", is_final: true, speech_final: true, channel: { alternatives: [{ transcript: "Hello there." }] } });
    expect(readTranscript(final)).toEqual({ kind: "final", text: "Hello there.", endOfSpeech: true });
  });
  it("reads utterance ends and ignores the rest", () => {
    expect(readTranscript(JSON.stringify({ type: "UtteranceEnd" }))).toEqual({ kind: "utterance_end" });
    expect(readTranscript(JSON.stringify({ type: "Metadata" }))).toEqual({ kind: "other" });
    expect(readTranscript("not json")).toEqual({ kind: "other" });
  });
});

describe("pcm16ToFloat", () => {
  it("decodes little-endian samples and keeps an odd byte", () => {
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x42]);
    const { samples, rest } = pcm16ToFloat(bytes);
    expect(Array.from(samples)).toEqual([-1, 32767 / 32768, 0]);
    expect(Array.from(rest)).toEqual([0x42]);
    expect(Array.from(concatBytes(rest, new Uint8Array([1])))).toEqual([0x42, 1]);
  });
});
