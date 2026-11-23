// Uploaded audio files -> mono samples for the modem (design "Audio adapters", R3.7–3.10).
//
// The browser does all the format work: decodeAudioData handles WAV, MP3, AAC, Ogg/Opus as far
// as that browser supports them, and we keep no parser of our own (R3.7). The decoder only needs
// mono samples and their rate, so channels are averaged. Averaging, not taking the left channel,
// because a ghost track mixed into stereo may sit in either channel or both.

import type { Result } from '../modem/types';

/** R3.10: the one failure message for anything the browser cannot decode. */
export const UNREADABLE_FILE = 'unsupported or unreadable audio file';

/** Files are decoded at this rate: inside the decoder's 16–48 kHz range on every device (R3.3). */
export const FILE_DECODE_SAMPLE_RATE = 48000;

/** The part of an AudioBuffer we use; a plain object in Node tests. */
export interface ChannelSource {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/** The part of a BaseAudioContext we use. */
export interface DecodeContext {
  decodeAudioData(data: ArrayBuffer): Promise<ChannelSource>;
}

export interface DecodedAudio {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

/** R3.9: the mean of all channels, sample by sample. One channel is returned as a copy. */
export function mixToMono(source: ChannelSource): Float32Array {
  const channels = source.numberOfChannels;
  const out = new Float32Array(source.length);
  if (channels < 1) return out;
  for (let c = 0; c < channels; c++) {
    const data = source.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += data[i] ?? 0;
  }
  if (channels > 1) for (let i = 0; i < out.length; i++) out[i]! /= channels;
  return out;
}

/**
 * Decode a file's bytes with the given context. Never throws: a rejected or throwing
 * decodeAudioData, or an empty result, becomes `{ ok: false, reason: UNREADABLE_FILE }`.
 * The samples come back at the context's rate (decodeAudioData resamples to it), so that is
 * the rate passed on to the decoder (R3.7).
 */
export async function decodeAudioFile(data: ArrayBuffer, context: DecodeContext): Promise<Result<DecodedAudio>> {
  try {
    // decodeAudioData detaches the buffer it is given, so hand it a copy and keep the caller's intact.
    const buffer = await context.decodeAudioData(data.slice(0));
    if (!buffer || buffer.length === 0 || buffer.numberOfChannels < 1) return { ok: false, reason: UNREADABLE_FILE };
    return { ok: true, value: { samples: mixToMono(buffer), sampleRate: buffer.sampleRate } };
  } catch {
    return { ok: false, reason: UNREADABLE_FILE };
  }
}

/** The browser's decoding context for uploads: offline (no audio device needed) at a fixed 48 kHz. */
export function createFileDecodeContext(): DecodeContext {
  const ctx = new OfflineAudioContext(1, 1, FILE_DECODE_SAMPLE_RATE);
  return { decodeAudioData: (data) => ctx.decodeAudioData(data) };
}
