// Live listening: microphone -> capture worklet -> decoder worker -> events (R4.1).

import { isSupportedSampleRate } from '../modem/decoder';
import type { DecoderEvent, Result } from '../modem/types';
import workletUrl from './capture.worklet.ts?worker&url';
import { CAPTURE_PROCESSOR, type FromWorker, type ToWorker } from './protocol';

/**
 * R4.1 / tech.md: every processing stage off. Echo cancellation, noise suppression and automatic
 * gain control are built for voices and treat a steady tone stream as noise to remove.
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } },
};

export interface Listening {
  /** The rate the decoder runs at: the AudioContext's actual rate, never assumed. */
  readonly sampleRate: number;
  stop(): Promise<void>;
}

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
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data;
      if (m.type === 'events') handlers.onEvents(m.events, m.pushedSamples, m.levelDb, m.gapSamples);
      else if (m.type === 'error') handlers.onError(m.message);
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
    return {
      ok: true,
      value: {
        sampleRate,
        stop: async () => {
          source.disconnect();
          node.disconnect();
          for (const t of tracks) t.stop();
          postToWorker(w, { type: 'flush' });
          // Give the worker a moment to send the flush events before it is closed.
          await new Promise((resolve) => setTimeout(resolve, 300));
          w.terminate();
          await ctx.close();
        },
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
