// Mono 16-bit PCM WAV reading and writing (R1.6).
//
// Pure functions on bytes: no DOM, no Web Audio, so they run in Node tests. They
// only handle the one format Ghost Tape exports. Uploaded files of any other type
// go through the browser's decodeAudioData instead (R3.7), never through here.

import type { Result } from '../modem/types';

const HEADER_BYTES = 44;
const MAX_DATA_BYTES = 0xffffffff - (HEADER_BYTES - 8);

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/**
 * Float samples in [-1, 1] -> a complete WAV file. Samples are clamped, non-finite
 * values become silence, and each is rounded to the nearest of 65,536 levels
 * (x · 32768, with +1.0 clamped to 32767).
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Result<Uint8Array> {
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff) return fail(`invalid sample rate ${sampleRate}`);
  const dataBytes = samples.length * 2;
  if (dataBytes > MAX_DATA_BYTES) return fail('too many samples for a WAV file');
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string): void => {
    for (let i = 0; i < 4; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  tag(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    const level = Number.isFinite(x) ? Math.round(Math.max(-1, Math.min(1, x)) * 32768) : 0;
    view.setInt16(HEADER_BYTES + i * 2, Math.max(-32768, Math.min(32767, level)), true);
  }
  return { ok: true, value: bytes };
}

export interface DecodedWav {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

/** Inverse of encodeWav for mono 16-bit PCM files. Other formats are reported, not guessed at. */
export function decodeWav(bytes: Uint8Array): Result<DecodedWav> {
  if (bytes.length < 12) return fail('file too short for a WAV header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagAt = (o: number): string => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tagAt(0) !== 'RIFF' || tagAt(8) !== 'WAVE') return fail('not a RIFF/WAVE file');

  let format: { channels: number; sampleRate: number; bits: number; code: number } | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tagAt(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) return fail('fmt chunk is truncated');
      format = { code: view.getUint16(body, true), channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!format) return fail('data chunk before fmt chunk');
      if (format.code !== 1) return fail(`unsupported WAV encoding ${format.code}, need PCM`);
      if (format.channels !== 1) return fail(`need mono, file has ${format.channels} channels`);
      if (format.bits !== 16) return fail(`need 16-bit samples, file has ${format.bits}`);
      // A declared size past the end of the file (streamed or cut-off files) is clamped to what is there.
      const available = Math.min(size, bytes.length - body);
      const count = Math.floor(available / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(body + i * 2, true) / 32768;
      return { ok: true, value: { samples, sampleRate: format.sampleRate } };
    }
    offset = body + size + (size % 2); // chunks are padded to even sizes
  }
  return fail(format ? 'no data chunk' : 'no fmt chunk');
}
