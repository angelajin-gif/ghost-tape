// Playing a ghost track out loud, once or looped, and saving it as a WAV file (R1.6).

import { encodeWav } from './wav';
import type { Result } from '../modem/types';

export interface Playing {
  stop(): void;
  /** Resolves when playback ends by itself or is stopped. */
  readonly ended: Promise<void>;
}

/**
 * Play samples on the context. With `loop`, the track plays again and again with 1 s of silence
 * between plays, the same gap the encoder's loop mode uses (R1.9), until stopped: a broadcast.
 */
export function playSamples(context: AudioContext, samples: Float32Array, sampleRate: number, loop: boolean): Playing {
  const gap = loop ? sampleRate : 0;
  // An AudioBuffer at the track's own rate; the context resamples to the device rate if they differ.
  const buffer = context.createBuffer(1, samples.length + gap, sampleRate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  source.connect(context.destination);
  const ended = new Promise<void>((resolve) => {
    source.onended = () => resolve();
  });
  source.start();
  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    },
    ended,
  };
}

/** R1.6: the track as a mono 16-bit PCM WAV Blob at its own sample rate. */
export function wavBlob(samples: Float32Array, sampleRate: number): Result<Blob> {
  const bytes = encodeWav(samples, sampleRate);
  if (!bytes.ok) return bytes;
  return { ok: true, value: new Blob([bytes.value as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }) };
}

/** Save a Blob through a temporary download link. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
