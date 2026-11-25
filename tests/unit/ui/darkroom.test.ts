import { describe, expect, it } from 'vitest';
import { nextWakeMs, reduceBatches, reduceDarkroom } from '../../../src/ui/darkroom/reduce';
import { initialDarkroom, NOTICE_COPY_KEY } from '../../../src/ui/darkroom/state';
import { notices } from '../../../src/ui/copy';
import { FAINT_GRACE_MS, FIX_TOTAL_MS, SAFELIGHT_FLICKER_MS } from '../../../src/ui/tokens';
import { complete, finalBatch, header, passComplete, progress, synthTape } from '../../support/synthFeed';

const tape = synthTape({ kind: 'tape', title: 'Side A', from: 'Ana', to: 'Ben', date: '2026-11-25', tracks: ['One', 'Two'], letter: 'Hello,\nBen.' });
const ghost = synthTape({ kind: 'ghost', message: 'Shelter open at the hall.' });

describe('darkroom reducer examples', () => {
  it('a batch holding pass-complete then complete fixes the print and never arms the faint notice', () => {
    const s0 = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape), progress(tape, 0.9, 3)] }, 1000);
    const s1 = reduceDarkroom(s0, { type: 'batch', events: finalBatch(tape, 1) }, 2000);
    expect(s1.phase).toBe('fixing');
    expect(s1.pendingFaint).toBeUndefined();
    expect(s1.clarityPct).toBe(100);
    expect(s1.passesUsed).toBe(1);
    expect(nextWakeMs(s1, 2000)).toBe(FIX_TOTAL_MS);
    expect(reduceDarkroom(s1, { type: 'tick' }, 2000 + FIX_TOTAL_MS - 1).phase).toBe('fixing');
    expect(reduceDarkroom(s1, { type: 'tick' }, 2000 + FIX_TOTAL_MS).phase).toBe('developed');
  });

  it('a pass-complete alone arms the notice, and every notice is a key that exists in copy.ts', () => {
    const s0 = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape), progress(tape, 0.5, 1)] }, 1000);
    const s1 = reduceDarkroom(s0, { type: 'batch', events: [passComplete(tape, 1, { clarity: 0.4 })] }, 2000);
    expect(s1.pendingFaint).toEqual({ tapeId: tape.tapeId, sinceMs: 2000 });
    const s2 = reduceDarkroom(s1, { type: 'tick' }, 2000 + FAINT_GRACE_MS);
    expect(s2.notice).toBe('faint');
    for (const key of Object.values(NOTICE_COPY_KEY)) expect(typeof notices[key]).toBe('string');
  });

  it('switches to Single-line in the same call that learns the Kind byte, and back from a wrong guess at complete', () => {
    const s0 = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(ghost)] }, 10);
    expect(s0.paper!.sheet).toBe('generic');
    const s1 = reduceBatches(s0, [[progress(ghost, 1, 1)]], 20);
    expect(s1.paper!.sheet).toBe('single-line');
    const s2 = reduceDarkroom(s1, { type: 'batch', events: [complete(ghost, 1)] }, 30);
    expect(s2.paper!.sheet).toBe('single-line');
    expect(s2.paper!.hint).toBeUndefined();
  });

  it('complete without a header builds the Paper from the payload; reset clears everything', () => {
    const s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [complete(tape, 2)] }, 10);
    expect(s.phase).toBe('fixing');
    expect(s.paper!.sheet).toBe('jcard');
    expect(s.paper!.hint).toBeDefined();
    expect(s.paper!.glyphs.has.every((x) => x === 1)).toBe(true);
    expect(reduceDarkroom(s, { type: 'reset' }, 20)).toEqual(initialDarkroom());
  });

  it('flickers the Safelight once and a tick ends it', () => {
    const s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [{ type: 'signal-detected', atSample: 0 }] }, 100);
    expect(s.safelight.flickerUntilMs).toBe(100 + SAFELIGHT_FLICKER_MS);
    expect(nextWakeMs(s, 100)).toBe(SAFELIGHT_FLICKER_MS);
    expect(reduceDarkroom(s, { type: 'tick' }, 100 + SAFELIGHT_FLICKER_MS).safelight.flickerUntilMs).toBeUndefined();
  });

  it('already-received sets its notice only for the developed tape', () => {
    const fixed = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [complete(tape, 1)] }, 10);
    expect(reduceDarkroom(fixed, { type: 'batch', events: [{ type: 'already-received', tapeId: ghost.tapeId }] }, 20)).toBe(fixed);
    expect(reduceDarkroom(fixed, { type: 'batch', events: [{ type: 'already-received', tapeId: tape.tapeId }] }, 20).notice).toBe('already-received');
  });
});
