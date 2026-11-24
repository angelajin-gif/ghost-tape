// The real AudioPort over the task-15 adapters (see the mismatch table in src/ui/audioPort.ts).

import type { AudioPort, FeedSession, ListenResult, PlayHandle } from '../ui/audioPort';
import { createFileDecodeContext, decodeAudioFile } from './file';
import { classifyMicFailure } from './micFailure';
import { startListening } from './mic';
import { schedulePass } from './passScheduler';
import { playSamples } from './playback';
import { keepScreenAwake } from './wakeLock';
import { defaultWorkerFactory, encodeInWorker, openFeed, type WorkerFactory } from './workerClient';

async function hasAudioInput(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'audioinput');
  } catch {
    return true; // could not ask: do not claim there is no microphone
  }
}

export function createAudioPort(makeWorker: WorkerFactory = defaultWorkerFactory): AudioPort {
  let context: AudioContext | undefined;

  return {
    async ensureContext() {
      try {
        context ??= new AudioContext();
        if (context.state !== 'running') await context.resume();
        return { ok: true, value: { sampleRate: context.sampleRate } };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },

    async listen(onBatch, onActivity): Promise<ListenResult> {
      const started = await startListening({
        onEvents: (events, pushedSamples, levelDb, gapSamples) => {
          // Empty messages are the once-per-second heartbeat, not decoder batches (mismatch 3).
          if (events.length > 0) onBatch([...events]);
          onActivity?.({ pushedSamples, levelDb, gapSamples });
        },
        onError: () => undefined,
      });
      if (started.ok) return { ok: true, value: started.value };
      const secureContext = typeof isSecureContext === 'boolean' ? isSecureContext : true;
      const hasInput = secureContext && navigator.mediaDevices ? await hasAudioInput() : true;
      return { ok: false, reason: classifyMicFailure(started.reason, { secureContext, hasAudioInput: hasInput }) };
    },

    openFeed(sampleRate, onBatch, onError = () => undefined): FeedSession {
      return openFeed(makeWorker, sampleRate, onBatch, onError);
    },

    async decodeFile(file) {
      return decodeAudioFile(await file.arrayBuffer(), createFileDecodeContext());
    },

    async fetchAsset(url) {
      try {
        const response = await fetch(url);
        if (!response.ok) return { ok: false, reason: `could not load ${url} (${response.status})` };
        return { ok: true, value: await response.arrayBuffer() };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },

    play(samples, sampleRate): PlayHandle {
      if (!context) throw new Error('ensureContext() must resolve before play()');
      const startedAtSec = context.currentTime;
      const playing = playSamples(context, samples, sampleRate, false);
      return { startedAtSec, stop: playing.stop, ended: playing.ended };
    },

    encode: (payload, profile, sampleRate, timeoutMs) => encodeInWorker(makeWorker, payload, profile, sampleRate, timeoutMs),

    schedule(samples, sampleRate, atSec) {
      if (!context) throw new Error('ensureContext() must resolve before schedule()');
      return schedulePass(context, samples, sampleRate, atSec);
    },

    get nowSec() {
      return context?.currentTime ?? 0;
    },

    keepAwake: () => keepScreenAwake(),
  };
}
