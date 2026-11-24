// Web Worker that owns the streaming decoder, so decoding never blocks the UI (tech.md).
// Audio arrives from the capture worklet on an attached MessagePort, or as 'samples' messages
// from the UI; events go back to the UI after every chunk that produced some.

import { createDecoder, encodePayload, summarizeEvents } from '../modem/index';
import type { Decoder, DecoderEvent } from '../modem/types';
import type { CaptureFrame, FromWorker, ToWorker } from './protocol';

/** The slice of the worker global scope used here (the DOM lib types `self` as a Window). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
}
const scope = self as unknown as WorkerScope;

let decoder: Decoder | undefined;
let pushed = 0;

function send(message: FromWorker): void {
  scope.postMessage(message);
}

let rate = 48000;
let reportedSecond = 0;
let sumSquares = 0;
let counted = 0;

/** Send events if there are any, and at least once per second of audio so the UI can show that audio is arriving and how loud. */
function report(events: readonly DecoderEvent[]): void {
  const second = Math.floor(pushed / rate);
  if (events.length > 0 || second > reportedSecond) {
    reportedSecond = second;
    // 10·log10(mean square) is the RMS level in dBFS; a full-scale sine is −3 dB, silence −∞ (shown as −120).
    const levelDb = counted > 0 && sumSquares > 0 ? 10 * Math.log10(sumSquares / counted) : -120;
    sumSquares = 0;
    counted = 0;
    send({ type: 'events', events, pushedSamples: pushed, levelDb, gapSamples });
  }
}

/** Longest gap filled with silence. Longer ones lose the pass anyway; this caps the memory a suspended tab could cost. */
const MAX_GAP_SECONDS = 5;
let nextFrame: number | undefined;
let gapSamples = 0;

/**
 * A quantum from the worklet. If the audio clock jumped past the samples we expected, quanta were
 * lost before they reached us: fill the hole with silence. The decoder tolerates a short dropout
 * (R5.6), but not a time slip: a missing stretch would pull every later symbol early by its length.
 */
function capture({ frame, samples }: CaptureFrame): void {
  if (nextFrame !== undefined && frame > nextFrame) {
    const missing = Math.min(frame - nextFrame, MAX_GAP_SECONDS * rate);
    gapSamples += missing;
    push(new Float32Array(missing));
  }
  nextFrame = frame + samples.length;
  push(samples);
}

function push(samples: Float32Array): void {
  if (!decoder) return;
  pushed += samples.length;
  for (const x of samples) if (Number.isFinite(x)) sumSquares += x * x;
  counted += samples.length;
  report(decoder.push(samples));
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'start':
        decoder = createDecoder({ sampleRate: message.sampleRate });
        rate = message.sampleRate;
        pushed = 0;
        reportedSecond = 0;
        gapSamples = 0;
        break;
      case 'attach':
        nextFrame = undefined;
        message.port.onmessage = (event: MessageEvent<CaptureFrame>) => capture(event.data);
        break;
      case 'samples':
        push(message.samples);
        break;
      case 'flush':
        if (decoder) report(decoder.flush());
        send({ type: 'flushed' });
        break;
      case 'encode': {
        // Whole-track rendering stays off the main thread; the client enforces the timeout by terminating the worker.
        const result = encodePayload(message.payload, { profile: message.profile, sampleRate: message.sampleRate });
        send({ type: 'encoded', id: message.id, result });
        break;
      }
      case 'reset':
        decoder?.reset();
        pushed = 0;
        break;
      case 'decode-file': {
        // The same steps as decodeFile (push everything, flush), keeping the events for the UI.
        const d = createDecoder({ sampleRate: message.sampleRate });
        const events = [...d.push(message.samples), ...d.flush()];
        send({ type: 'file-result', result: summarizeEvents(events), events });
        break;
      }
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
