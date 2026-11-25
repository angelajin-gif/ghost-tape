// Feature: ghost-tape-ui
// Property 11 (countdown part): Countdown, clarity and pass display; Property 12: Fixing timeline;
// Property 32: Sheet geometry; Property 34: Developed text is hidden, then revealed.
// **Validates: Requirements 4.3, 6.4, 8.1 to 8.7, 10.2, 10.3, 13.1, 13.2, 14.1**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serializePayload } from '../../../src/modem/tape';
import type { Payload } from '../../../src/modem/types';
import { layoutFromPayload } from '../../../src/ui/darkroom/layoutHint';
import { reduceDarkroom } from '../../../src/ui/darkroom/reduce';
import { genericSheet, jcardSheet, singleLineSheet } from '../../../src/ui/darkroom/sheet';
import { initialDarkroom, type DarkroomState } from '../../../src/ui/darkroom/state';
import { countdownSec, fixProgress, safelightView, shownRemainingSec, warmLevel } from '../../../src/ui/darkroom/timeline';
import { developedView } from '../../../src/ui/darkroom/viewModel';
import { FIX_TOTAL_MS, SHEET_CELL_MIN_PX } from '../../../src/ui/tokens';
import { payloadArb, tapeArb } from '../../support/arbitraries';
import { complete, header, progress, synthTape } from '../../support/synthFeed';
import { fcUi } from '../../support/uiRuns';

const EPS = 1e-6;

/** Reduce a header, a progress and the `complete` event of a payload; returns the state and the time of `complete`. */
function developing(payload: Payload, completeAtMs = 1000): DarkroomState {
  const tape = synthTape(payload);
  let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape, 1, 12), progress(tape, 0.5, 3)] }, completeAtMs - 500);
  s = reduceDarkroom(s, { type: 'batch', events: [complete(tape, 2)] }, completeAtMs);
  return s;
}

const increasingTimes = (start: number): fc.Arbitrary<number[]> =>
  fc.array(fc.integer({ min: 0, max: 800 }), { minLength: 1, maxLength: 12 }).map((steps) => {
    let t = start;
    return steps.map((d) => (t += d));
  });

// ---- P11, countdown part --------------------------------------------------------------

describe('P11 countdown from the anchor', () => {
  it('is a whole number, never below 0 and non-increasing over time', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 700, noNaN: true }), fc.integer({ min: 0, max: 10_000 }), fc.nat(100_000), fc.nat(100_000), (remainingSec, atMs, d1, d2) => {
        const anchor = { remainingSec, atMs, running: true };
        const r1 = shownRemainingSec(anchor, atMs + Math.min(d1, d2));
        const r2 = shownRemainingSec(anchor, atMs + Math.max(d1, d2));
        expect(Number.isInteger(r1) && Number.isInteger(r2)).toBe(true);
        expect(r2).toBeGreaterThanOrEqual(0);
        expect(r2).toBeLessThanOrEqual(r1);
      }),
      fcUi(),
    );
  });

  it('shows the estimate rounded up at the anchor and is corrected by progress within the same call', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 600, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (est, f) => {
        const tape = synthTape({ kind: 'ghost', message: 'hello' });
        let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape, 1, est)] }, 1000);
        expect(countdownSec(s, 1000)).toBe(Math.ceil(est));
        s = reduceDarkroom(s, { type: 'batch', events: [progress(tape, f, 1)] }, 1500);
        expect(countdownSec(s, 1500)).toBe(Math.max(0, Math.ceil(est * (1 - f))));
      }),
      fcUi(),
    );
  });

  it('stops where it is after a discard and is not shown before a header or after complete', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 600 }), fc.nat(5000), fc.nat(60_000), (est, wait, later) => {
        const tape = synthTape({ kind: 'ghost', message: 'hello' });
        expect(countdownSec(initialDarkroom(), 0)).toBeUndefined();
        let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape, 1, est)] }, 1000);
        s = reduceDarkroom(s, { type: 'batch', events: [{ type: 'pass-discarded', reason: 'signal-lost' }] }, 1000 + wait);
        expect(countdownSec(s, 1000 + wait + later)).toBe(countdownSec(s, 1000 + wait));
        const done = developing({ kind: 'ghost', message: 'hello' });
        expect(countdownSec(done, 5000)).toBeUndefined();
      }),
      fcUi(),
    );
  });
});

// ---- P12 --------------------------------------------------------------------------------

describe('P12 fixing timeline', () => {
  it('fixProgress is within [0, 1], non-decreasing, and 1 at fixStartMs + FIX_TOTAL_MS', () => {
    expect(FIX_TOTAL_MS).toBeLessThanOrEqual(1500);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: -2000, max: 4000 }), fc.integer({ min: -2000, max: 4000 }), (fixStartMs, a, b) => {
        const s = { fixStartMs };
        const [t1, t2] = a <= b ? [fixStartMs + a, fixStartMs + b] : [fixStartMs + b, fixStartMs + a];
        const p1 = fixProgress(s, t1);
        const p2 = fixProgress(s, t2);
        expect(p1).toBeGreaterThanOrEqual(0);
        expect(p2).toBeLessThanOrEqual(1);
        expect(p2).toBeGreaterThanOrEqual(p1);
        expect(fixProgress(s, fixStartMs + FIX_TOTAL_MS)).toBe(1);
        expect(fixProgress(s, fixStartMs + a, true)).toBe(1); // Reduced motion: at once (R8.3)
      }),
      fcUi(),
    );
    expect(fixProgress({ fixStartMs: undefined }, 5000)).toBe(0);
  });

  it('the glyph bytes set at complete equal serializePayload(payload) and stay so through the whole moment', () => {
    fc.assert(
      fc.property(payloadArb, increasingTimes(1000), (payload, ticks) => {
        const serialized = serializePayload(payload);
        if (!serialized.ok) throw new Error(serialized.reason);
        let s = developing(payload, 1000);
        const check = (state: DarkroomState): void => {
          const g = state.paper!.glyphs;
          expect(Array.from(g.byte)).toEqual(Array.from(serialized.value));
          expect(Array.from(g.has).every((h) => h === 1)).toBe(true);
          expect(Array.from(g.conf).every((c) => c === 1)).toBe(true);
        };
        check(s);
        for (const t of ticks) {
          s = reduceDarkroom(s, { type: 'tick' }, t);
          check(s);
        }
      }),
      fcUi(),
    );
  });

  it('the Safelight dims to off and the warm light rises over the moment; both are final under Reduced motion', () => {
    fc.assert(
      fc.property(payloadArb, increasingTimes(1000), (payload, ticks) => {
        const s = developing(payload, 1000);
        let prevLight = 1;
        let prevWarm = 0;
        for (const t of [1000, ...ticks]) {
          const light = safelightView(s, t).level;
          const warm = warmLevel(s, t);
          expect(light).toBeLessThanOrEqual(prevLight);
          expect(warm).toBeGreaterThanOrEqual(prevWarm);
          [prevLight, prevWarm] = [light, warm];
        }
        expect(safelightView(s, 1000 + FIX_TOTAL_MS)).toEqual({ mode: 'off', level: 0 });
        expect(warmLevel(s, 1000 + FIX_TOTAL_MS)).toBe(1);
        expect(safelightView(s, 1000, true)).toEqual({ mode: 'off', level: 0 });
        expect(warmLevel(s, 1000, true)).toBe(1);
      }),
      fcUi(),
    );
  });

  it('the Safelight flickers once after signal-detected, then returns to steady', () => {
    const s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [{ type: 'signal-detected', atSample: 0 }] }, 1000);
    expect(safelightView(initialDarkroom(), 1000)).toEqual({ mode: 'steady', level: 1 });
    expect(safelightView(s, 1100).mode).toBe('flicker');
    expect(safelightView(s, 1100).level).toBeLessThan(1);
    expect(safelightView(s, s.safelight.flickerUntilMs!)).toEqual({ mode: 'steady', level: 1 });
  });
});

// ---- P34 --------------------------------------------------------------------------------

describe('P34 developed text is hidden, then revealed', () => {
  it('text is the payload from the complete call; revealed only from fixStartMs + FIX_TOTAL_MS, never back', () => {
    fc.assert(
      fc.property(payloadArb, increasingTimes(1001), (payload, ticks) => {
        const completeAtMs = 1000;
        const tape = synthTape(payload);
        let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape), progress(tape, 0.4, 2)] }, 500);
        expect(developedView(s)).toEqual({ text: undefined, controlsEnabled: false, label: 'not-yet', revealed: false });
        s = reduceDarkroom(s, { type: 'batch', events: [complete(tape, 1)] }, completeAtMs);
        // The DOM write is in the same reduce call as the event, so well within 500 ms.
        expect(developedView(s).text).toEqual(payload);
        expect(developedView(s).controlsEnabled).toBe(true);
        expect(developedView(s).revealed).toBe(false);
        let wasRevealed = false;
        for (const t of ticks) {
          s = reduceDarkroom(s, { type: 'tick' }, t);
          const v = developedView(s);
          expect(v.text).toEqual(payload);
          expect(v.revealed).toBe(t >= completeAtMs + FIX_TOTAL_MS);
          if (wasRevealed) expect(v.revealed).toBe(true);
          wasRevealed = v.revealed;
        }
        s = reduceDarkroom(s, { type: 'reset' }, 99_999);
        expect(developedView(s)).toEqual({ text: undefined, controlsEnabled: false, label: 'not-yet', revealed: false });
      }),
      fcUi(),
    );
  });

  it('with Reduced motion the text is revealed in the frame that processes complete', () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const s = developing(payload);
        expect(developedView(s, { reducedMotion: true }).revealed).toBe(true);
        expect(developedView(s, { reducedMotion: true }).text).toEqual(payload);
        expect(developedView(initialDarkroom(), { reducedMotion: true }).revealed).toBe(false);
      }),
      fcUi(),
    );
  });

  it('a second complete for any payload changes neither text nor revealed', () => {
    fc.assert(
      fc.property(payloadArb, payloadArb, fc.integer({ min: 0, max: 3000 }), (first, second, wait) => {
        const s1 = developing(first, 1000);
        const other = synthTape(second);
        const s2 = reduceDarkroom(s1, { type: 'batch', events: [complete(other, 3)] }, 1000 + wait);
        const s1Ticked = reduceDarkroom(s1, { type: 'tick' }, 1000 + wait);
        const s2Ticked = reduceDarkroom(s2, { type: 'tick' }, 1000 + wait);
        expect(developedView(s2).text).toEqual(first);
        expect(developedView(s2Ticked)).toEqual(developedView(s1Ticked));
      }),
      fcUi(),
    );
  });

  it('a complete whose payload cannot be laid out keeps the label "not yet" and the controls disabled (R8.7)', () => {
    const tape = synthTape({ kind: 'ghost', message: 'hi' });
    const bad = { ...complete(tape, 1), payload: { kind: 'ghost', message: '\u0001' } } as ReturnType<typeof complete>;
    const s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape), bad] }, 1000);
    expect(s.unreadable).toBe(true);
    expect(developedView(s, { reducedMotion: true })).toEqual({ text: undefined, controlsEnabled: false, label: 'not-yet', revealed: false });
    expect(safelightView(s, 5000).mode).toBe('steady');
  });
});

// ---- P32 --------------------------------------------------------------------------------

describe('P32 sheet geometry', () => {
  const widthArb = fc.integer({ min: 280, max: 1200 });

  it('Generic: cols <= floor(width / 8), cols * rows >= P, (rows - 1) * cols < P, positive cells', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1024 }), widthArb, (p, width) => {
        const g = genericSheet(p, width);
        expect(g.cols).toBeLessThanOrEqual(Math.floor(width / SHEET_CELL_MIN_PX));
        expect(g.cols).toBeGreaterThanOrEqual(1);
        expect(g.cols * g.rows).toBeGreaterThanOrEqual(p);
        expect((g.rows - 1) * g.cols).toBeLessThan(p);
        expect(g.cellWidthPx).toBeGreaterThan(0);
        expect(g.cellHeightPx).toBeGreaterThan(0);
        expect(g.cols * g.cellWidthPx).toBeLessThanOrEqual(width + EPS);
      }),
      fcUi(),
    );
  });

  it('Generic examples from the design: P = 136 at 328 px and P = 1024 at 328 px', () => {
    expect([genericSheet(136, 328).cols, genericSheet(136, 328).rows]).toEqual([17, 8]);
    expect([genericSheet(1024, 328).cols, genericSheet(1024, 328).rows]).toEqual([41, 25]);
  });

  it('Single-line: max(1, P - 2) cells, wrapped inside the width, one empty cell for P < 2', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1024 }), widthArb, (p, width) => {
        const s = singleLineSheet(p, width);
        expect(s.cells).toBe(Math.max(1, p - 2));
        expect(s.cols * s.rows).toBeGreaterThanOrEqual(s.cells);
        expect((s.rows - 1) * s.cols).toBeLessThan(s.cells);
        expect(s.cellWidthPx).toBeGreaterThan(0);
        expect(s.cols * s.cellWidthPx).toBeLessThanOrEqual(width + EPS);
      }),
      fcUi(),
    );
    expect([singleLineSheet(0, 300).cells, singleLineSheet(1, 300).cells, singleLineSheet(2, 300).cells]).toEqual([1, 1, 1]);
  });

  it('J-card: every slot lies inside the sheet and no two slots overlap', () => {
    fc.assert(
      fc.property(tapeArb, widthArb, (tape, width) => {
        const hint = layoutFromPayload(tape);
        expect(hint).toBeDefined();
        const sheet = jcardSheet(hint!, width);
        expect(sheet.widthPx).toBe(width);
        for (const s of sheet.slots) {
          expect(s.xPx).toBeGreaterThanOrEqual(0);
          expect(s.yPx).toBeGreaterThanOrEqual(0);
          expect(s.widthPx).toBeGreaterThan(0);
          expect(s.heightPx).toBeGreaterThan(0);
          expect(s.xPx + s.widthPx).toBeLessThanOrEqual(sheet.widthPx + EPS);
          expect(s.yPx + s.heightPx).toBeLessThanOrEqual(sheet.heightPx + EPS);
          expect(s.cols * s.rows).toBeGreaterThanOrEqual(s.length > 0 ? s.length : 0);
        }
        for (let i = 0; i < sheet.slots.length; i++) {
          for (let j = i + 1; j < sheet.slots.length; j++) {
            const a = sheet.slots[i]!;
            const b = sheet.slots[j]!;
            const apart = a.xPx + a.widthPx <= b.xPx || b.xPx + b.widthPx <= a.xPx || a.yPx + a.heightPx <= b.yPx || b.yPx + b.heightPx <= a.yPx;
            expect(apart).toBe(true);
          }
        }
        // One slot each for title, from, to, date and letter, plus one per track, in payload order.
        expect(sheet.slots.length).toBe(5 + tape.tracks.length);
      }),
      fcUi(),
    );
  });
});
