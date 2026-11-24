// Tests of the UI test harness itself: fcUi, FakeAudioPort, synthFeed.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../../src/modem/crc32';
import type { Ghost, Payload } from '../../../src/modem/index';
import type { AudioPort } from '../../../src/ui/audioPort';
import { FakeAudioPort } from '../../support/fakeAudioPort';
import { seed } from '../../support/runs';
import { complete, finalBatch, header, passComplete, progress, synthTape } from '../../support/synthFeed';
import { fcUi } from '../../support/uiRuns';

const ghost: Ghost = { kind: 'ghost', message: 'Water at the north gate' };

describe('fcUi', () => {
  it('uses the fixed seed and never fewer than 100 runs', () => {
    expect(fcUi()).toEqual({ numRuns: 100, seed });
    expect(fcUi(10).numRuns).toBe(100);
    expect(fcUi(250).numRuns).toBe(250);
  });

  it('sample property runs 100 cases', () => {
    let cases = 0;
    fc.assert(
      fc.property(fc.integer(), (n) => {
        cases += 1;
        return n + 0 === n;
      }),
      fcUi(),
    );
    expect(cases).toBe(100);
  });
});

describe('FakeAudioPort', () => {
  it('is an AudioPort and records calls', async () => {
    const clock = { nowSec: 5 };
    const port: AudioPort = new FakeAudioPort({ clock });
    const fake = port as FakeAudioPort;
    expect(await port.ensureContext()).toEqual({ ok: true, value: { sampleRate: 48000 } });
    const listened = await port.listen(() => {});
    expect(listened.ok).toBe(true);
    if (listened.ok) await listened.value.stop();
    await port.encode(ghost as Payload, 'robust', 44100, 5000);
    const handle = port.play(new Float32Array(4), 44100);
    port.schedule(new Float32Array(4), 44100, 9).cancel();
    expect(fake.ensureContextCalls).toHaveLength(1);
    expect(fake.listenCalls[0]!.stopCalls).toBe(1);
    expect(fake.encodeCalls[0]).toMatchObject({ profile: 'robust', sampleRate: 44100, timeoutMs: 5000 });
    expect(handle.startedAtSec).toBe(5);
    expect(fake.scheduleCalls[0]).toMatchObject({ atSec: 9, cancelled: true });
    fake.advance(2);
    expect(port.nowSec).toBe(7);
  });

  it('pushes batches to the listener and refuses empty ones', async () => {
    const fake = new FakeAudioPort();
    const seen: number[] = [];
    await fake.listen((events) => seen.push(events.length));
    fake.pushBatch(finalBatch(synthTape(ghost)));
    expect(seen).toEqual([2]);
    expect(() => fake.pushBatch([])).toThrow();
  });

  it('in manual mode a test resolves or rejects calls', async () => {
    const fake = new FakeAudioPort({ manual: true });
    const listening = fake.listen(() => {});
    const encoding = fake.encode(ghost, 'robust', 48000, 1000);
    let settled = false;
    void listening.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    fake.listenCalls[0]!.result.resolve({ ok: false, reason: 'denied' });
    expect(await listening).toEqual({ ok: false, reason: 'denied' });
    fake.encodeCalls[0]!.result.reject(new Error('worker died'));
    await expect(encoding).rejects.toThrow('worker died');
  });
});

describe('synthFeed', () => {
  const tape = synthTape(ghost, 'robust');

  it('takes tapeId and length from the real serializer and crc32', () => {
    expect(tape.tapeId).toBe(crc32(tape.bytes));
    const h = header(tape);
    expect(h).toMatchObject({ type: 'header', tapeId: tape.tapeId, payloadLength: tape.bytes.length, pass: 1 });
  });

  it('progress covers every position with confidence in 0..1 and is seeded', () => {
    const a = progress(tape, 0.5, 7);
    const b = progress(tape, 0.5, 7);
    expect(a).toEqual(b);
    if (a.type !== 'progress') throw new Error('expected progress');
    expect(a.provisional.map((p) => p.position)).toEqual(Array.from(tape.bytes, (_, i) => i));
    for (const p of a.provisional) {
      expect(p.kind).toBe('provisional');
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('a progress at fraction 1 carries the true bytes', () => {
    const full = progress(tape, 1);
    if (full.type !== 'progress') throw new Error('expected progress');
    expect(Uint8Array.from(full.provisional.map((p) => p.byte))).toEqual(tape.bytes);
  });

  it('the final batch is pass-complete followed by complete', () => {
    const batch = finalBatch(tape, 2);
    expect(batch.map((e) => e.type)).toEqual(['pass-complete', 'complete']);
    expect(batch[0]).toEqual(passComplete(tape, 2));
    expect(batch[1]).toMatchObject({ tapeId: tape.tapeId, payload: ghost });
    expect(complete(tape, 3)).toMatchObject({ passesUsed: 3 });
  });
});
