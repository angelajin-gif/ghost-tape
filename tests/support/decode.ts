import { decodeFile } from '../../src/modem/decoder';
import { encodePayload } from '../../src/modem/modulate';
import type { ProfileTable } from '../../src/modem/profiles';
import type { DecodeFileResult, Decoder, DecoderEvent, Payload } from '../../src/modem/types';
import { recordAudio, recordTrial } from './budget';

/** Encode or fail the test with the encoder's reason. */
export function encodeOrThrow(payload: Payload, profile: string, sampleRate: number, passes?: number, profiles?: ProfileTable): Float32Array {
  const r = encodePayload(payload, { profile, sampleRate, ...(passes !== undefined ? { passes } : {}), ...(profiles ? { profiles } : {}) });
  if (!r.ok) throw new Error(`encode failed: ${r.reason}`);
  return r.value.samples;
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
