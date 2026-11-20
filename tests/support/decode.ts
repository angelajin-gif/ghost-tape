import { whiteNoise } from '../../src/modem/channel';
import { decodeFile } from '../../src/modem/decoder';
import { frameLayout, sampleAtMs } from '../../src/modem/frame';
import { geometry, payloadSymbolCount } from '../../src/modem/interleave';
import { encodePayload } from '../../src/modem/modulate';
import { PROFILES, ROBUST, type ProfileTable } from '../../src/modem/profiles';
import { serializePayload } from '../../src/modem/tape';
import type { DecodeFileResult, Decoder, DecoderEvent, Payload } from '../../src/modem/types';
import { recordAudio, recordTrial } from './budget';

/** Encode or fail the test with the encoder's reason. */
export function encodeOrThrow(payload: Payload, profile: string, sampleRate: number, passes?: number, profiles?: ProfileTable): Float32Array {
  const r = encodePayload(payload, { profile, sampleRate, ...(passes !== undefined ? { passes } : {}), ...(profiles ? { profiles } : {}) });
  if (!r.ok) throw new Error(`encode failed: ${r.reason}`);
  return r.value.samples;
}

/** Sample range [start, end) of a track's payload symbols (after the header, before the postamble), for damaging only the payload. */
export function payloadSpan(payload: Payload, profileName: string, sampleRate: number): { start: number; end: number } {
  const bytes = serializePayload(payload);
  if (!bytes.ok) throw new Error(bytes.reason);
  const profile = PROFILES.find((p) => p.name === profileName)!;
  const layout = frameLayout(payloadSymbolCount(geometry(bytes.value.length), profile), profile, ROBUST);
  return { start: sampleAtMs(layout.payloadStartMs, sampleRate), end: sampleAtMs(layout.postambleStartMs, sampleRate) };
}

/**
 * A copy of the track with the given fraction range of its payload drowned in loud white noise
 * (RMS 0.3): a pass that lost part of the message. Noise, not silence, because silence of
 * 400 ms or more ends the pass as signal-lost (design "Signal lost"), which is a different test.
 */
export function losePayloadPart(track: Float32Array, span: { start: number; end: number }, fromFraction: number, toFraction: number, seed = 1): Float32Array {
  const out = track.slice();
  const length = span.end - span.start;
  const from = span.start + Math.round(fromFraction * length);
  const to = span.start + Math.round(toFraction * length);
  out.set(whiteNoise(to - from, 0.3, seed), from);
  return out;
}

/** decodeFile, counting the audio and the trial against the deep-suite cap (R11.13). */
export function decodeCounted(cell: string, samples: Float32Array, sampleRate: number, profiles?: ProfileTable): DecodeFileResult {
  recordTrial(cell);
  recordAudio(cell, samples.length, sampleRate);
  return decodeFile(samples, sampleRate, profiles);
}

/** Run a whole stream through a decoder in the given chunk sizes (cycled) and collect every event, flush included. */
export function runInChunks(decoder: Decoder, samples: Float32Array, chunkSizes: readonly number[], cell?: string, sampleRate?: number): DecoderEvent[] {
  if (cell && sampleRate) recordAudio(cell, samples.length, sampleRate);
  const events: DecoderEvent[] = [];
  let offset = 0;
  let i = 0;
  while (offset < samples.length) {
    const size = chunkSizes[i++ % chunkSizes.length]!;
    events.push(...decoder.push(samples.subarray(offset, Math.min(samples.length, offset + size))));
    offset += size;
  }
  events.push(...decoder.flush());
  return events;
}
