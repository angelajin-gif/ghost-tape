// Live listening: microphone -> capture worklet -> decoder worker -> events (R4.1).

import { isSupportedSampleRate } from '../modem/decoder';
import type { DecoderEvent, Result } from '../modem/types';
import workletUrl from './capture.worklet.ts?worker&url';
import { CAPTURE_PROCESSOR, type FromWorker, type ToWorker, type WorkletMessage } from './protocol';

/**
 * R4.1 / tech.md: every processing stage off. Echo cancellation, noise suppression and automatic
 * gain control are built for voices and treat a steady tone stream as noise to remove.
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } },
};

export interface Recording {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  /** True when the 10-minute cap was reached and later audio was not kept. */
  readonly truncated: boolean;
}

export interface Listening {
  /** The rate the decoder runs at: the AudioContext's actual rate, never assumed. */
  readonly sampleRate: number;
  /** Dev harness: start or stop keeping a copy of the decoder's input (real-room fixtures). */
  record(on: boolean): void;
  /** Dev harness: what was recorded since the last take, exactly as the decoder received it. */
  takeRecording(): Promise<Recording>;
  /** Stop listening once every captured sample has been decoded (at most STOP_TIMEOUT_MS). */
  stop(): Promise<void>;
  /** The same, returning the recording, complete up to the last sample decoded (dev harness). */
  stopAndTakeRecording(): Promise<Recording | undefined>;
}

/** How long stop() waits for the worker to finish the audio it still has queued. */
export const STOP_TIMEOUT_MS = 5000;

export interface ListenHandlers {
  onEvents(events: readonly DecoderEvent[], pushedSamples: number, levelDb: number, gapSamples: number): void;
  onError(message: string): void;
}

/** Start the decoder worker. Shared with file decoding in the dev harness. */
export function createDecoderWorker(): Worker {
  return new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' });
}

export function postToWorker(worker: Worker, message: ToWorker, transfer: Transferable[] = []): void {
  worker.postMessage(message, transfer);
}

/**
 * Ask for the microphone and start decoding. Call from a user gesture (Safari only starts audio
 * then). Resolves to a failure, never throws, when the mic is refused or audio cannot start.
 */
export async function startListening(handlers: ListenHandlers): Promise<Result<Listening>> {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let worker: Worker | undefined;
  try {
    if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'this browser has no microphone access here (it needs HTTPS)' };
    stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    context = new AudioContext();
    // A device running above 48 kHz (some audio interfaces) is outside the decoder's range: ask for 48 kHz instead.
    if (!isSupportedSampleRate(context.sampleRate)) {
      await context.close();
      context = new AudioContext({ sampleRate: 48000 });
    }
    await context.resume();
    const sampleRate = context.sampleRate;
    await context.audioWorklet.addModule(workletUrl);

    worker = createDecoderWorker();
    const w = worker;
    let onFlushed: (() => void) | undefined;
    let onRecording: ((r: Recording) => void) | undefined;
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data;
      if (m.type === 'events') handlers.onEvents(m.events, m.pushedSamples, m.levelDb, m.gapSamples);
      else if (m.type === 'error') handlers.onError(m.message);
      else if (m.type === 'flushed') onFlushed?.();
      else if (m.type === 'recording') onRecording?.({ samples: m.samples, sampleRate: m.sampleRate, truncated: m.truncated });
    };
    postToWorker(w, { type: 'start', sampleRate });

    const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const channel = new MessageChannel();
    postToWorker(w, { type: 'attach', port: channel.port2 }, [channel.port2]);
    node.port.postMessage({ type: 'attach', port: channel.port1 }, [channel.port1]);

    const source = context.createMediaStreamSource(stream);
    // Some browsers only run nodes that lead to the speakers; a silent gain keeps it running without feedback.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(context.destination);

    const ctx = context;
    const tracks = stream.getTracks();
    const take = (): Promise<Recording> =>
      new Promise<Recording>((resolve) => {
        onRecording = resolve;
        postToWorker(w, { type: 'take-recording' });
      });
    const finish = async (takeRecording: boolean): Promise<Recording | undefined> => {
      // No new frames, then an end marker behind the frames already on their way: the worker
      // flushes only once it has decoded all of them, however far behind it is, and replies.
      source.disconnect();
      for (const t of tracks) t.stop();
      const flushed = new Promise<boolean>((resolve) => {
        onFlushed = () => resolve(true);
        setTimeout(() => resolve(false), STOP_TIMEOUT_MS);
      });
      const end: WorkletMessage = { type: 'end' };
      node.port.postMessage(end);
      if (!(await flushed)) handlers.onError(`the decoder did not finish within ${STOP_TIMEOUT_MS / 1000} s; the last pass may be missing from the log`);
      const taken = takeRecording ? await take() : undefined;
      node.disconnect();
      w.terminate();
      await ctx.close();
      return taken;
    };
    return {
      ok: true,
      value: {
        sampleRate,
        record: (on: boolean) => postToWorker(w, { type: 'record', on }),
        takeRecording: take,
        stop: async () => {
          await finish(false);
        },
        stopAndTakeRecording: () => finish(true),
      },
    };
  } catch (error) {
    for (const t of stream?.getTracks() ?? []) t.stop();
    worker?.terminate();
    await context?.close().catch(() => undefined);
    const name = error instanceof Error ? error.name : '';
    const reason = name === 'NotAllowedError' ? 'microphone permission was refused' : `could not start listening: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, reason };
  }
}
