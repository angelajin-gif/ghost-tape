// The only way views reach audio. Types only: no DOM, no Web Audio, so views and tests import it
// freely. The real implementation is src/audio/audioPortImpl.ts; tests use a fake.
//
// Task 1.1 gate: the design's "Assumed from task 15" table checked against the real adapters.
//
// | # | Assumed (design)                                   | Real adapter                                                                                   | Change (port or impl)                                                                                          |
// |---|----------------------------------------------------|------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
// | 1 | Mic constraints all false                          | `MIC_CONSTRAINTS` in mic.ts: all three false (plus channelCount ideal 1)                        | None                                                                                                           |
// | 2 | Worklet batches 128-sample quanta to ~1024         | Worklet posts every 128-sample quantum (about 375 per second) to the worker, stamped with the clock | None for the port: the messages go worklet to worker, not to the main thread. Worker load only             |
// | 3 | One worker message per push/flush; empty posts nothing | One message per decoder call, but a message with an EMPTY events array is also posted once per second of audio (heartbeat with `pushedSamples`, `levelDb`, `gapSamples`) | Impl drops empty arrays from `onBatch`. Port adds `onActivity` carrying the heartbeat (level meter, "no signal heard", K1) |
// | 4 | Worker runs encodePayload with timeout             | No `encode` message                                                                             | Added `encode`/`encoded` to protocol.ts and decoder.worker.ts; workerClient.ts times out and terminates         |
// | 5 | (implicit) feed knows when flush is done           | `flush` gave no acknowledgement                                                                 | Added a `flushed` message; a feed closes its worker on it                                                       |
// | 6 | Shared AudioContext for listen and play            | `startListening` creates its own AudioContext (and may recreate it at 48 kHz); playSamples needs one passed in | `ensureContext` serves play/schedule only; `ListenSession.sampleRate` is the mic context's rate, which can differ |
// | 7 | `listen` fails with a `MicFailure` code            | `startListening` fails with a free-text reason string                                           | Impl classifies: secure-context check, reason text, `enumerateDevices` (pure `classifyMicFailure`). `rate-unsupported` is never produced because mic.ts falls back to 48 kHz |
// | 8 | `ListenSession.stop(): void`                       | `Listening.stop()` is async (flushes, waits 300 ms, closes)                                     | Port: `stop(): Promise<void>`. Tracks stop synchronously at the start of the call, so R3.9 holds without awaiting |
// | 9 | File decode at 48000 Hz, mono mix                  | `createFileDecodeContext` (OfflineAudioContext 48000) and `mixToMono` in file.ts                | None. `decodeFile` reads the Blob and calls `decodeAudioFile`                                                   |
// | 10 | `openFeed` has no error path                      | The worker reports `error` messages (for example an unsupported rate)                           | Port: `openFeed(rate, onBatch, onError)`                                                                        |
// | 11 | `play` returns `startedAtSec`; loop optional      | `playSamples(context, samples, rate, loop)` returns `{ stop, ended }`; no start time            | Impl records `context.currentTime` just before the call (start() with no argument plays at once). No loop in the port |
// | 12 | `schedule` on the audio clock                     | Nothing: `playSamples` always starts now                                                         | New passScheduler.ts (`source.start(atSec)`)                                                                    |
// | 13 | Wake Lock                                         | Nothing                                                                                          | New wakeLock.ts; no-op when unsupported                                                                         |
// | 14 | `fetchAsset`                                      | Nothing                                                                                          | Impl uses `fetch`, never throws                                                                                  |
// | 15 | Sample-rate handling                              | Mic: context rate, 48 kHz fallback above 48 kHz. File: fixed 48 kHz. Encode: 44100 or 48000 only | Port `encode` takes the rate and returns a Result; callers pick 44100 or 48000. `play` resamples through the context |
//
// Nothing here needs a developer decision. I7 (batch splitting) is not triggered: batches are not split.

import type { DecoderEvent, EncodedTrack, Payload, ProfileId, Result } from '../modem/index';

export type MicFailure = 'denied' | 'no-microphone' | 'insecure-context' | 'rate-unsupported' | 'failed';

export type ListenResult =
  | { readonly ok: true; readonly value: ListenSession }
  | { readonly ok: false; readonly reason: MicFailure };

/** Sent about once per second of audio, even when no events were produced. */
export interface ListenActivity {
  /** Audio the decoder has received so far. */
  readonly pushedSamples: number;
  /** RMS level since the previous activity message, dBFS (-120 for silence). */
  readonly levelDb: number;
  /** Samples the audio clock skipped, filled with silence. */
  readonly gapSamples: number;
}

export interface ListenSession {
  /** Rate of the microphone's own AudioContext (not necessarily the playback context's) [R3.4]. */
  readonly sampleRate: number;
  /** Stops every mic track synchronously, then resolves once the decoder's final events were delivered [R3.9]. */
  stop(): Promise<void>;
}

export interface PlayHandle {
  /** AudioContext.currentTime when the first sample plays. */
  readonly startedAtSec: number;
  stop(): void;
  readonly ended: Promise<void>;
}

export interface FeedSession {
  /** Chunks of at most FILE_CHUNK_SEC seconds. */
  push(samples: Float32Array): void;
  /** Calls flush() exactly once [R12.7]; later calls do nothing. */
  finish(): void;
  cancel(): void;
}

export interface AudioPort {
  /** Create or resume the shared playback AudioContext inside a user gesture. */
  ensureContext(): Promise<Result<{ sampleRate: number }>>;
  /**
   * Batches are the events of one decoder call, never empty and never split [I7].
   * `onActivity` gets the once-per-second heartbeat.
   */
  listen(onBatch: (events: DecoderEvent[]) => void, onActivity?: (activity: ListenActivity) => void): Promise<ListenResult>;
  openFeed(sampleRate: number, onBatch: (events: DecoderEvent[]) => void, onError?: (message: string) => void): FeedSession;
  /** Decoded at 48000 Hz and averaged to mono [R12.3]. */
  decodeFile(file: Blob): Promise<Result<{ samples: Float32Array; sampleRate: number }>>;
  fetchAsset(url: string): Promise<Result<ArrayBuffer>>;
  play(samples: Float32Array, sampleRate: number): PlayHandle;
  /** One encodePayload call in a worker. sampleRate must be 44100 or 48000. Fails with a reason on timeout. */
  encode(payload: Payload, profile: ProfileId, sampleRate: number, timeoutMs: number): Promise<Result<EncodedTrack>>;
  /** Side B: one pass starting at an audio-clock time (seconds on `nowSec`'s clock). */
  schedule(samples: Float32Array, sampleRate: number, atSec: number): { cancel(): void };
  /** Playback context's currentTime; 0 before ensureContext. */
  readonly nowSec: number;
  keepAwake(): Promise<{ release(): void }>;
}
