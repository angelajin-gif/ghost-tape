// A recording AudioPort for UI tests. Views never touch real audio, so every view test runs
// against this. By default calls resolve at once; set `manual` to settle them from the test.

import type {
  AudioPort,
  FeedSession,
  ListenActivity,
  ListenResult,
  PlayHandle,
} from '../../src/ui/audioPort';
import type { DecoderEvent, EncodedTrack, Payload, ProfileId, Result } from '../../src/modem/index';

/** Injectable audio clock, in seconds. */
export interface FakeClock {
  nowSec: number;
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  settled: boolean;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const d: Deferred<T> = {
    promise,
    settled: false,
    resolve(value) {
      d.settled = true;
      resolve(value);
    },
    reject(error) {
      d.settled = true;
      reject(error);
    },
  };
  return d;
}

export interface ListenCall {
  readonly onBatch: (events: DecoderEvent[]) => void;
  readonly onActivity: ((activity: ListenActivity) => void) | undefined;
  readonly result: Deferred<ListenResult>;
  /** Times `stop()` was called on the session this call produced. */
  stopCalls: number;
}

export interface EncodeCall {
  readonly payload: Payload;
  readonly profile: ProfileId;
  readonly sampleRate: number;
  readonly timeoutMs: number;
  readonly result: Deferred<Result<EncodedTrack>>;
}

export interface PlayCall {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly startedAtSec: number;
  stopCalls: number;
  /** Resolve to simulate playback reaching its end. */
  readonly ended: Deferred<void>;
}

export interface ScheduleCall {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly atSec: number;
  cancelled: boolean;
}

export interface FeedCall {
  readonly sampleRate: number;
  readonly onBatch: (events: DecoderEvent[]) => void;
  readonly onError: ((message: string) => void) | undefined;
  readonly pushed: Float32Array[];
  finishCalls: number;
  cancelCalls: number;
}

export interface FakeAudioPortOptions {
  /** When true no call settles by itself; the test resolves or rejects it. Default false. */
  readonly manual?: boolean;
  readonly clock?: FakeClock;
  readonly sampleRate?: number;
}

export class FakeAudioPort implements AudioPort {
  readonly clock: FakeClock;
  readonly manual: boolean;
  readonly sampleRate: number;

  readonly ensureContextCalls: Deferred<Result<{ sampleRate: number }>>[] = [];
  readonly listenCalls: ListenCall[] = [];
  readonly feedCalls: FeedCall[] = [];
  readonly encodeCalls: EncodeCall[] = [];
  readonly playCalls: PlayCall[] = [];
  readonly scheduleCalls: ScheduleCall[] = [];
  readonly decodeFileCalls: Blob[] = [];
  readonly fetchAssetCalls: string[] = [];
  keepAwakeCalls = 0;
  keepAwakeReleases = 0;

  constructor(options: FakeAudioPortOptions = {}) {
    this.manual = options.manual ?? false;
    this.clock = options.clock ?? { nowSec: 0 };
    this.sampleRate = options.sampleRate ?? 48000;
  }

  get nowSec(): number {
    return this.clock.nowSec;
  }

  /** Move the injected audio clock forward. */
  advance(seconds: number): void {
    this.clock.nowSec += seconds;
  }

  ensureContext(): Promise<Result<{ sampleRate: number }>> {
    const call = deferred<Result<{ sampleRate: number }>>();
    this.ensureContextCalls.push(call);
    if (!this.manual) call.resolve({ ok: true, value: { sampleRate: this.sampleRate } });
    return call.promise;
  }

  listen(
    onBatch: (events: DecoderEvent[]) => void,
    onActivity?: (activity: ListenActivity) => void,
  ): Promise<ListenResult> {
    const call: ListenCall = { onBatch, onActivity, result: deferred<ListenResult>(), stopCalls: 0 };
    this.listenCalls.push(call);
    if (!this.manual) {
      call.result.resolve({
        ok: true,
        value: {
          sampleRate: this.sampleRate,
          stop: async () => {
            call.stopCalls += 1;
          },
        },
      });
    }
    return call.result.promise;
  }

  openFeed(sampleRate: number, onBatch: (events: DecoderEvent[]) => void, onError?: (message: string) => void): FeedSession {
    const call: FeedCall = { sampleRate, onBatch, onError, pushed: [], finishCalls: 0, cancelCalls: 0 };
    this.feedCalls.push(call);
    return {
      push: (samples) => {
        call.pushed.push(samples);
      },
      // The real session flushes exactly once; later calls do nothing [R12.7].
      finish: () => {
        call.finishCalls = 1;
      },
      cancel: () => {
        call.cancelCalls += 1;
      },
    };
  }

  /** Default result is one second of silence at 48000 Hz; tests wanting other audio use `manual`. */
  decodeFile(file: Blob): Promise<Result<{ samples: Float32Array; sampleRate: number }>> {
    this.decodeFileCalls.push(file);
    return Promise.resolve({ ok: true, value: { samples: new Float32Array(48000), sampleRate: 48000 } });
  }

  fetchAsset(url: string): Promise<Result<ArrayBuffer>> {
    this.fetchAssetCalls.push(url);
    return Promise.resolve({ ok: true, value: new ArrayBuffer(0) });
  }

  play(samples: Float32Array, sampleRate: number): PlayHandle {
    const call: PlayCall = {
      samples,
      sampleRate,
      startedAtSec: this.clock.nowSec,
      stopCalls: 0,
      ended: deferred<void>(),
    };
    this.playCalls.push(call);
    return {
      startedAtSec: call.startedAtSec,
      stop: () => {
        call.stopCalls += 1;
        if (!call.ended.settled) call.ended.resolve();
      },
      ended: call.ended.promise,
    };
  }

  encode(payload: Payload, profile: ProfileId, sampleRate: number, timeoutMs: number): Promise<Result<EncodedTrack>> {
    const call: EncodeCall = { payload, profile, sampleRate, timeoutMs, result: deferred<Result<EncodedTrack>>() };
    this.encodeCalls.push(call);
    if (!this.manual) {
      const samples = new Float32Array(sampleRate);
      call.result.resolve({ ok: true, value: { samples, durationSec: samples.length / sampleRate } });
    }
    return call.result.promise;
  }

  schedule(samples: Float32Array, sampleRate: number, atSec: number): { cancel(): void } {
    const call: ScheduleCall = { samples, sampleRate, atSec, cancelled: false };
    this.scheduleCalls.push(call);
    return {
      cancel: () => {
        call.cancelled = true;
      },
    };
  }

  keepAwake(): Promise<{ release(): void }> {
    this.keepAwakeCalls += 1;
    return Promise.resolve({
      release: () => {
        this.keepAwakeReleases += 1;
      },
    });
  }

  /** Deliver one decoder batch to the most recent `listen` call. Empty batches are refused (I7). */
  pushBatch(events: DecoderEvent[], listenIndex = this.listenCalls.length - 1): void {
    if (events.length === 0) throw new Error('FakeAudioPort: batches are never empty');
    const call = this.listenCalls[listenIndex];
    if (call === undefined) throw new Error('FakeAudioPort: no listen call to push to');
    call.onBatch(events);
  }

  /** Deliver one decoder batch to a feed opened with `openFeed`. */
  pushFeedBatch(events: DecoderEvent[], feedIndex = this.feedCalls.length - 1): void {
    if (events.length === 0) throw new Error('FakeAudioPort: batches are never empty');
    const call = this.feedCalls[feedIndex];
    if (call === undefined) throw new Error('FakeAudioPort: no feed to push to');
    call.onBatch(events);
  }
}
