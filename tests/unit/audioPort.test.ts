// Task 1.1: the port adapters against the REAL worker core (decoder.worker.ts), through a fake Worker.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyMicFailure } from '../../src/audio/micFailure';
import type { FromWorker, ToWorker } from '../../src/audio/protocol';
import { encodeInWorker, openFeed, type WorkerLike } from '../../src/audio/workerClient';
import { createDecoder, encodePayload } from '../../src/modem/index';
import type { DecoderEvent, Payload } from '../../src/modem/types';

interface FakeScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
}

let scope: FakeScope;
const toClient: FromWorker[] = [];
let client: WorkerLike | undefined;
const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');

beforeAll(async () => {
  scope = {
    onmessage: null,
    postMessage: (message) => {
      toClient.push(message);
      client?.onmessage?.({ data: message } as MessageEvent<FromWorker>);
    },
  };
  Object.defineProperty(globalThis, 'self', { value: scope, configurable: true, writable: true });
  await import('../../src/audio/decoder.worker'); // installs scope.onmessage
});
afterAll(() => {
  if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf);
  else delete (globalThis as { self?: unknown }).self;
});

/** A Worker whose other end is the real worker core. */
function fakeWorker(): WorkerLike {
  const w: WorkerLike = {
    onmessage: null,
    postMessage: (message) => scope.onmessage?.({ data: message } as MessageEvent<ToWorker>),
    terminate: () => undefined,
  };
  client = w;
  return w;
}

const payload: Payload = { kind: 'ghost', message: 'A ghost on the air.' };

describe('worker core batches through the port client (I7, K4)', () => {
  it('delivers exactly the arrays a direct decoder gives, one per push, none empty, and flushes once', () => {
    const track = encodePayload(payload, { profile: 'standard', sampleRate: 48000 });
    if (!track.ok) throw new Error(track.reason);
    const samples = track.value.samples;

    const reference = createDecoder({ sampleRate: 48000 });
    const expected: DecoderEvent[][] = [];
    const chunk = 4800;
    for (let i = 0; i < samples.length; i += chunk) {
      const events = reference.push(samples.subarray(i, i + chunk));
      if (events.length > 0) expected.push(events);
    }
    const tail = reference.flush();
    if (tail.length > 0) expected.push(tail);

    toClient.length = 0;
    const got: DecoderEvent[][] = [];
    const feed = openFeed(fakeWorker, 48000, (b) => got.push(b), () => undefined);
    for (let i = 0; i < samples.length; i += chunk) feed.push(samples.slice(i, i + chunk));
    feed.finish();
    feed.finish();

    expect(got).toEqual(expected);
    expect(got.every((b) => b.length > 0)).toBe(true);
    // pass-complete and complete stay in one batch (R9.1).
    const withComplete = got.find((b) => b.some((e) => e.type === 'complete'));
    expect(withComplete?.some((e) => e.type === 'pass-complete')).toBe(true);
    expect(toClient.filter((m) => m.type === 'flushed')).toHaveLength(1);
  });
});

describe('encodeInWorker', () => {
  it('renders in the worker core and matches a direct encodePayload', async () => {
    const direct = encodePayload(payload, { profile: 'standard', sampleRate: 44100 });
    const r = await encodeInWorker(fakeWorker, payload, 'standard', 44100, 10_000);
    expect(r.ok && direct.ok && r.value.samples.length === direct.value.samples.length).toBe(true);
  });
  it('reports an encoder failure as a reason', async () => {
    const r = await encodeInWorker(fakeWorker, payload, 'no-such-profile', 48000, 10_000);
    expect(r.ok).toBe(false);
  });
  it('times out and terminates a worker that never answers', async () => {
    let terminated = false;
    const silent: WorkerLike = { onmessage: null, postMessage: () => undefined, terminate: () => (terminated = true) };
    const r = await encodeInWorker(() => silent, payload, 'standard', 48000, 20);
    expect(r.ok).toBe(false);
    expect(terminated).toBe(true);
  });
});

describe('classifyMicFailure', () => {
  it('maps reasons and facts to port codes', () => {
    const ok = { secureContext: true, hasAudioInput: true };
    expect(classifyMicFailure('x', { ...ok, secureContext: false })).toBe('insecure-context');
    expect(classifyMicFailure('microphone permission was refused', ok)).toBe('denied');
    expect(classifyMicFailure('could not start listening: x', { ...ok, hasAudioInput: false })).toBe('no-microphone');
    expect(classifyMicFailure('could not start listening: x', ok)).toBe('failed');
  });
});
