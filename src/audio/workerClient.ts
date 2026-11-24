// Typed client over the decoder worker: feeds (file decoding) and one-shot encoding.
// Live microphone listening keeps using mic.ts, which owns its own worker.

import type { EncodedTrack } from '../modem/modulate';
import type { DecoderEvent, Payload, ProfileId, Result } from '../modem/types';
import type { FromWorker, ToWorker } from './protocol';

/** The slice of Worker used here, so tests can pass a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  postMessage(message: ToWorker): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

export const defaultWorkerFactory: WorkerFactory = () => new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export interface FeedHandle {
  push(samples: Float32Array): void;
  finish(): void;
  cancel(): void;
}

/**
 * A decoder fed from the caller. Each worker message that holds events becomes exactly one
 * `onBatch` call with the array unchanged, so a push's events (pass-complete and complete)
 * stay together. Empty heartbeat messages are dropped.
 */
export function openFeed(
  make: WorkerFactory,
  sampleRate: number,
  onBatch: (events: DecoderEvent[]) => void,
  onError: (message: string) => void,
): FeedHandle {
  const worker = make();
  let closed = false;
  let finished = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    worker.terminate();
  };
  worker.onmessage = (event) => {
    if (closed) return;
    const m = event.data;
    if (m.type === 'events') {
      if (m.events.length > 0) onBatch([...m.events]);
    } else if (m.type === 'error') onError(m.message);
    else if (m.type === 'flushed') close();
  };
  worker.postMessage({ type: 'start', sampleRate });
  return {
    push: (samples) => {
      if (!closed && !finished) worker.postMessage({ type: 'samples', samples });
    },
    finish: () => {
      if (closed || finished) return;
      finished = true;
      worker.postMessage({ type: 'flush' });
    },
    cancel: close,
  };
}

/** Render a whole track in a fresh worker. On timeout the worker is terminated, which stops the work. */
export function encodeInWorker(
  make: WorkerFactory,
  payload: Payload,
  profile: ProfileId,
  sampleRate: number,
  timeoutMs: number,
): Promise<Result<EncodedTrack>> {
  return new Promise((resolve) => {
    let worker: WorkerLike;
    try {
      worker = make();
    } catch (error) {
      resolve({ ok: false, reason: `could not start the encoder: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    let settled = false;
    const settle = (result: Result<EncodedTrack>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => settle({ ok: false, reason: `encoding took longer than ${timeoutMs} ms` }), timeoutMs);
    worker.onmessage = (event) => {
      const m = event.data;
      if (m.type === 'encoded') settle(m.result);
      else if (m.type === 'error') settle({ ok: false, reason: m.message });
    };
    worker.postMessage({ type: 'encode', id: 1, payload, profile, sampleRate });
  });
}
