// Feature: ghost-tape-ui
// Property 3: Kind detection; Property 5: Symbol history across the reducer; Property 6: No Fixing without `complete`;
// Property 7: Progress application and coalescing; Property 8: A discarded pass leaves the state as it was;
// Property 9: Batch rule for the "still faint" notice; Property 11: Countdown, clarity and pass display.
// **Validates: Requirements 4.1 to 4.11, 5.1 to 5.11, 7.7, 8.6, 9.1 to 9.10, 10.1 to 10.9, 13.1, 13.9, 37.5**
//
// Events come from the `synthFeed` constructors (a unit-test fixture, R37.4); the reducer sees only
// DecoderEvent batches, ticks and resets, exactly as in the app.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DecoderEvent, DiscardReason } from '../../../src/modem/types';
import { displayedByte } from '../../../src/ui/darkroom/glyphs';
import { historyValues } from '../../../src/ui/darkroom/history';
import { detectKind } from '../../../src/ui/darkroom/kind';
import { nextWakeMs, reduceBatches, reduceDarkroom, type DarkroomInput } from '../../../src/ui/darkroom/reduce';
import { initialDarkroom, type DarkroomState, type KindReading } from '../../../src/ui/darkroom/state';
import { FAINT_GRACE_MS, FIX_TOTAL_MS, FLICKER_BELOW, HISTORY_DEPTH, KIND_CONFIDENCE_MIN } from '../../../src/ui/tokens';
import { smallPayloadArb } from '../../support/arbitraries';
import { complete, header, passComplete, progress, seededRandom, synthTape, type SynthTape } from '../../support/synthFeed';
import { fcUi } from '../../support/uiRuns';

// ---- Generators ------------------------------------------------------------------------

/** Three distinct tapes: two to play and one that is never announced by a header ("unknown tapeId"). */
const tapesArb = fc
  .uniqueArray(smallPayloadArb.map((p) => synthTape(p)), { minLength: 3, maxLength: 3, selector: (t) => t.tapeId })
  .map((ts): readonly [SynthTape, SynthTape, SynthTape] => [ts[0]!, ts[1]!, ts[2]!]);

const reasonArb = fc.constantFrom<DiscardReason>('header-invalid', 'alignment-failed', 'signal-lost');
const which = fc.integer({ min: 0, max: 2 });

type EventSpec =
  | { t: 'signal' }
  | { t: 'header'; i: number; pass: number; est: number }
  | { t: 'progress'; i: number; f: number; seed: number }
  | { t: 'passComplete'; i: number; clarity: number }
  | { t: 'complete'; i: number; used: number }
  | { t: 'already'; i: number }
  | { t: 'discard'; reason: DiscardReason };

const eventSpecArb: fc.Arbitrary<EventSpec> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<EventSpec>({ t: 'signal' }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('header' as const), i: which, pass: fc.integer({ min: 1, max: 4 }), est: fc.integer({ min: 0, max: 90 }) }) },
  { weight: 5, arbitrary: fc.record({ t: fc.constant('progress' as const), i: which, f: fc.double({ min: 0, max: 1, noNaN: true }), seed: fc.integer({ min: 0, max: 1e6 }) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('passComplete' as const), i: which, clarity: fc.double({ min: 0, max: 1, noNaN: true }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('complete' as const), i: which, used: fc.integer({ min: 1, max: 5 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('already' as const), i: which }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('discard' as const), reason: reasonArb }) },
);

function toEvent(spec: EventSpec, tapes: readonly SynthTape[]): DecoderEvent {
  switch (spec.t) {
    case 'signal':
      return { type: 'signal-detected', atSample: 0 };
    case 'header':
      return header(tapes[spec.i]!, spec.pass, spec.est);
    case 'progress':
      return progress(tapes[spec.i]!, spec.f, spec.seed);
    case 'passComplete':
      return passComplete(tapes[spec.i]!, 1, { clarity: spec.clarity });
    case 'complete':
      return complete(tapes[spec.i]!, spec.used);
    case 'already':
      return { type: 'already-received', tapeId: tapes[spec.i]!.tapeId };
    case 'discard':
      return { type: 'pass-discarded', reason: spec.reason };
  }
}

type StepSpec = { k: 'batch'; events: EventSpec[]; dtMs: number } | { k: 'tick'; dtMs: number } | { k: 'reset' };

const stepArb: fc.Arbitrary<StepSpec> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ k: fc.constant('batch' as const), events: fc.array(eventSpecArb, { minLength: 1, maxLength: 3 }), dtMs: fc.integer({ min: 0, max: 400 }) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('tick' as const), dtMs: fc.integer({ min: 0, max: 1500 }) }) },
  { weight: 1, arbitrary: fc.constant<StepSpec>({ k: 'reset' }) },
);

const stepsArb = fc.array(stepArb, { minLength: 1, maxLength: 14 });

interface Traced {
  readonly step: StepSpec;
  readonly input: DarkroomInput;
  readonly nowMs: number;
  readonly before: DarkroomState;
  readonly after: DarkroomState;
}

function run(steps: readonly StepSpec[], tapes: readonly SynthTape[], start: DarkroomState = initialDarkroom(), startMs = 1000): Traced[] {
  const out: Traced[] = [];
  let state = start;
  let now = startMs;
  for (const step of steps) {
    now += step.k === 'reset' ? 0 : step.dtMs;
    const input: DarkroomInput =
      step.k === 'batch' ? { type: 'batch', events: step.events.map((s) => toEvent(s, tapes)) } : step.k === 'tick' ? { type: 'tick' } : { type: 'reset' };
    const after = reduceDarkroom(state, input, now);
    out.push({ step, input, nowMs: now, before: state, after });
    state = after;
  }
  return out;
}

const f32 = Math.fround;

// ---- P3 --------------------------------------------------------------------------------

describe('P3 kind detection', () => {
  const expectedKind = (byte: number, c: number, has: number): KindReading =>
    has !== 1 || !(c >= KIND_CONFIDENCE_MIN) ? 'unknown' : byte === 0 ? 'tape' : byte === 1 ? 'ghost' : 'invalid';

  it('detectKind follows the rule for any snapshot', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 6 }),
        fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { maxLength: 6 }),
        fc.array(fc.constantFrom(0, 1), { maxLength: 6 }),
        fc.constantFrom(0, 1, 2, 7, 255),
        fc.float({ min: 0, max: 1, noNaN: true }),
        (rest, confRest, hasRest, byte0, conf0) => {
          const bytes = Uint8Array.from([byte0, ...rest]);
          const conf = Float32Array.from([conf0, ...confRest]);
          const has = Uint8Array.from([1, ...hasRest]);
          expect(detectKind(bytes, conf, has)).toBe(expectedKind(byte0, conf0, 1));
          expect(detectKind(bytes, conf, Uint8Array.from([0, ...hasRest]))).toBe('unknown');
          expect(detectKind(new Uint8Array(0), new Float32Array(0), new Uint8Array(0))).toBe('unknown');
        },
      ),
      fcUi(),
    );
  });

  it('the reducer sheet follows the most recent confident reading, in the same call, and complete decides at the end', () => {
    const readingArb = fc.array(
      fc.record({ byte: fc.constantFrom(0, 1, 2, 200), conf: fc.float({ min: 0, max: 1, noNaN: true }) }),
      { minLength: 1, maxLength: 6 },
    );
    fc.assert(
      fc.property(tapesArb, readingArb, (tapes, readings) => {
        const tape = tapes[0];
        let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape)] }, 100);
        expect(s.paper!.sheet).toBe('generic'); // R5.1: a header never chooses
        expect(s.paper!.kind).toBe('unknown');
        let model: KindReading = 'unknown';
        readings.forEach((r, k) => {
          const base = progress(tape, 0.3, k) as Extract<DecoderEvent, { type: 'progress' }>;
          const first = { kind: 'provisional' as const, position: 0, byte: r.byte, confidence: r.conf };
          const e = { ...base, provisional: [first, ...base.provisional.slice(1)] };
          s = reduceDarkroom(s, { type: 'batch', events: [e] }, 200 + k);
          const reading = expectedKind(r.byte, r.conf, 1);
          if (reading !== 'unknown') model = reading;
          expect(s.paper!.kind).toBe(model);
          if (model === 'ghost') expect(s.paper!.sheet).toBe('single-line'); // R5.4, R13.1
          else if (model !== 'tape') expect(s.paper!.sheet).toBe('generic');
          if (model !== 'tape') expect(s.paper!.hint).toBeUndefined(); // R5.7, R6.11
          else expect(s.paper!.sheet).toBe(s.paper!.hint ? 'jcard' : 'generic');
        });
        s = reduceDarkroom(s, { type: 'batch', events: [complete(tape)] }, 900);
        expect(s.paper!.kind).toBe(tape.payload.kind);
        expect(s.paper!.sheet).toBe(tape.payload.kind === 'ghost' ? 'single-line' : 'jcard');
      }),
      fcUi(),
    );
  });
});

// ---- P5 --------------------------------------------------------------------------------

describe('P5 symbol history across the reducer', () => {
  it('every displayed byte is the current byte or a history member, with the rules of R7.3 to R7.8', () => {
    fc.assert(
      fc.property(tapesArb, stepsArb, fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 3 }), (tapes, steps, times) => {
        for (const t of run(steps, tapes)) {
          const paper = t.after.paper;
          if (!paper) continue;
          const { glyphs, history } = paper;
          for (let p = 0; p < paper.payloadLength; p++) {
            expect(history.count[p]!).toBeLessThanOrEqual(HISTORY_DEPTH);
            const values = historyValues(history, p);
            expect(new Set(values).size).toBe(values.length);
            if (glyphs.has[p]) expect(values).toContain(glyphs.byte[p]); // recordValue runs before the glyph is set
            for (const now of times) {
              for (const reduced of [false, true]) {
                const shown = displayedByte(glyphs, history, p, now, reduced);
                if (!glyphs.has[p]) {
                  expect(shown).toBeUndefined();
                  continue;
                }
                expect(shown === glyphs.byte[p] || values.includes(shown!)).toBe(true);
                if (reduced || values.length < 2 || glyphs.conf[p]! >= FLICKER_BELOW) expect(shown).toBe(glyphs.byte[p]);
                expect(displayedByte(glyphs, history, p, now, reduced)).toBe(shown);
              }
            }
          }
        }
      }),
      fcUi(),
    );
  });

  it('pass-complete leaves the history exactly as it was', () => {
    fc.assert(
      fc.property(tapesArb, fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 4 }), fc.double({ min: 0, max: 1, noNaN: true }), (tapes, fractions, clarity) => {
        const tape = tapes[0];
        let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape), ...fractions.map((f, k) => progress(tape, f, k))] }, 10);
        const before = s;
        s = reduceDarkroom(s, { type: 'batch', events: [passComplete(tape, 1, { clarity })] }, 20);
        expect(s.phase).toBe('between');
        expect(s.paper!.history).toEqual(before.paper!.history);
        expect(s.paper!.glyphs).toEqual(before.paper!.glyphs);
      }),
      fcUi(),
    );
  });
});

// ---- P6 --------------------------------------------------------------------------------

describe('P6 no Fixing without complete', () => {
  const fixed = (s: DarkroomState): boolean => s.phase === 'fixing' || s.phase === 'developed';

  it('Fixing needs a complete since the last reset; only reset leaves it; everything but already-received is ignored', () => {
    fc.assert(
      fc.property(tapesArb, stepsArb, (tapes, steps) => {
        let completeSeen = false;
        for (const t of run(steps, tapes)) {
          if (t.input.type === 'reset') {
            completeSeen = false;
            expect(t.after).toEqual(initialDarkroom());
            continue;
          }
          if (t.input.type === 'batch' && t.input.events.some((e) => e.type === 'complete')) completeSeen = true;
          if (fixed(t.after)) expect(completeSeen).toBe(true);
          if (!fixed(t.before)) continue;
          expect(fixed(t.after)).toBe(true); // R8.6: only reset leaves
          expect(t.after.fixStartMs).toBe(t.before.fixStartMs); // a second complete never restarts it
          if (t.input.type === 'tick') {
            expect(t.after.payload).toBe(t.before.payload);
            expect(t.after.paper).toEqual(t.before.paper);
          } else {
            const again = t.input.events.some((e) => e.type === 'already-received' && e.tapeId === t.before.paper?.tapeId);
            expect(t.after).toEqual(again ? { ...t.before, notice: 'already-received' } : t.before);
          }
        }
      }),
      fcUi(),
    );
  });

  it('a complete is needed even after many passes: headers, progress and pass-complete never reach Fixing', () => {
    fc.assert(
      fc.property(tapesArb, stepsArb, (tapes, steps) => {
        const noComplete = steps.map((s): StepSpec => (s.k === 'batch' ? { ...s, events: s.events.filter((e) => e.t !== 'complete') } : s)).filter((s) => s.k !== 'batch' || s.events.length > 0);
        for (const t of run(noComplete, tapes)) expect(t.after.phase === 'fixing' || t.after.phase === 'developed').toBe(false);
      }),
      fcUi(),
    );
  });
});

// ---- P7 --------------------------------------------------------------------------------

describe('P7 progress application and coalescing', () => {
  /** A progress event listing a seeded subset of positions. */
  function subsetProgress(tape: SynthTape, f: number, seed: number): Extract<DecoderEvent, { type: 'progress' }> {
    const full = progress(tape, f, seed) as Extract<DecoderEvent, { type: 'progress' }>;
    const rand = seededRandom(seed + 77);
    return { ...full, provisional: full.provisional.filter(() => rand() < 0.5) };
  }
  const plan = fc.array(fc.record({ f: fc.double({ min: 0, max: 1, noNaN: true }), seed: fc.integer({ min: 0, max: 1e6 }) }), { minLength: 1, maxLength: 5 });

  it('updates exactly the listed positions', () => {
    fc.assert(
      fc.property(tapesArb, plan, (tapes, steps) => {
        const tape = tapes[0];
        let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape)] }, 10);
        for (const { f, seed } of steps) {
          const e = subsetProgress(tape, f, seed);
          const prev = s.paper!.glyphs;
          s = reduceDarkroom(s, { type: 'batch', events: [e] }, 20);
          const listed = new Map(e.provisional.map((b) => [b.position, b]));
          const g = s.paper!.glyphs;
          for (let p = 0; p < tape.bytes.length; p++) {
            const b = listed.get(p);
            if (b) {
              expect([g.byte[p], g.has[p], g.conf[p]]).toEqual([b.byte, 1, f32(b.confidence)]);
            } else {
              expect([g.byte[p], g.has[p], g.conf[p]]).toEqual([prev.byte[p], prev.has[p], prev.conf[p]]);
            }
          }
        }
      }),
      fcUi(),
    );
  });

  it('a progress for a tapeId with no Paper changes nothing', () => {
    fc.assert(
      fc.property(tapesArb, plan, (tapes, steps) => {
        const [a, , c] = tapes;
        const events = steps.map(({ f, seed }) => progress(c, f, seed));
        expect(reduceBatches(initialDarkroom(), [events], 5)).toEqual(initialDarkroom());
        const s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(a)] }, 10);
        expect(reduceBatches(s, [events], 20)).toBe(s);
      }),
      fcUi(),
    );
  });

  it('one reduceBatches call equals reducing the batches one at a time', () => {
    fc.assert(
      fc.property(tapesArb, plan, (tapes, steps) => {
        const tape = tapes[0];
        const batches: DecoderEvent[][] = [[header(tape)], ...steps.map(({ f, seed }) => [subsetProgress(tape, f, seed)])];
        const together = reduceBatches(initialDarkroom(), batches, 50);
        let one = initialDarkroom();
        for (const b of batches) one = reduceDarkroom(one, { type: 'batch', events: b }, 50);
        expect(together.paper!.history).toEqual(one.paper!.history);
        expect(together.paper!.glyphs).toEqual(one.paper!.glyphs);
        expect(together).toEqual(one);
      }),
      fcUi(),
    );
  });
});

// ---- P8 --------------------------------------------------------------------------------

describe('P8 a discarded pass leaves the state as it was', () => {
  const prefixArb = fc.record({
    played: fc.boolean(),
    fractions: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 3 }),
    clarity: fc.double({ min: 0, max: 1, noNaN: true }),
  });

  it('restores glyphs, history, layout, clarity and parts; notice and in-progress marker are the only differences', () => {
    fc.assert(
      fc.property(
        tapesArb,
        prefixArb,
        fc.boolean(),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 4 }),
        reasonArb,
        (tapes, prefix, sameTape, discardedFractions, reason) => {
          const [a, b] = tapes;
          // S: `empty`, or `between` after one unfinished pass of tape A.
          const prefixEvents: DecoderEvent[] = prefix.played
            ? [header(a, 1), ...prefix.fractions.map((f, k) => progress(a, f, k)), passComplete(a, 1, { clarity: prefix.clarity })]
            : [];
          const S = reduceDarkroom(initialDarkroom(), { type: 'batch', events: prefixEvents }, 100);
          expect(['empty', 'between']).toContain(S.phase);

          const next = sameTape && prefix.played ? a : b;
          const events: DecoderEvent[] = [header(next, 2, 30), ...discardedFractions.map((f, k) => progress(next, f, 900 + k)), { type: 'pass-discarded', reason }];
          const R = reduceDarkroom(S, { type: 'batch', events }, 200);

          expect(R.phase).toBe('between');
          expect(R.passInProgress).toBe(false);
          expect(R.notice).toBe(reason); // notice keys mirror the reasons
          expect(R.pendingFaint).toBeUndefined();
          expect(R.paper).toBeDefined(); // the Paper stays in the tray (R9.7)
          if (S.paper) {
            expect(R.paper).toEqual(S.paper);
            expect(R.clarityPct).toBe(S.clarityPct);
            expect(R.parts).toEqual(S.parts);
          } else {
            // First header of a session: the blank Paper stays.
            expect(R.paper!.tapeId).toBe(next.tapeId);
            expect(Array.from(R.paper!.glyphs.has).every((x) => x === 0)).toBe(true);
            expect(Array.from(R.paper!.history.count).every((x) => x === 0)).toBe(true);
            expect(R.paper!.sheet).toBe('generic');
            expect(R.clarityPct).toBeUndefined();
          }
          // R10.9 (see KIRO_LOG): pass number stays as displayed, countdown stops.
          expect(R.pass).toBe(2);
          expect(R.countdown!.running).toBe(false);
        },
      ),
      fcUi(),
    );
  });

  it('signal-detected then pass-discarded with no header restores the steady Safelight', () => {
    fc.assert(
      fc.property(tapesArb, fc.boolean(), reasonArb, fc.integer({ min: 0, max: 5000 }), (tapes, played, reason, dt) => {
        const a = tapes[0];
        const S = reduceDarkroom(initialDarkroom(), { type: 'batch', events: played ? [header(a), passComplete(a, 1)] : [] }, 100);
        const flickered = reduceDarkroom(S, { type: 'batch', events: [{ type: 'signal-detected', atSample: 0 }] }, 150);
        expect(flickered.safelight.flickerUntilMs).toBeDefined();
        const R = reduceDarkroom(flickered, { type: 'batch', events: [{ type: 'pass-discarded', reason }] }, 150 + dt);
        expect(R.safelight).toEqual(S.safelight);
        expect(R.phase).toBe(S.phase);
        expect(R.paper).toEqual(S.paper);
      }),
      fcUi(),
    );
  });
});

// ---- P9 --------------------------------------------------------------------------------

describe('P9 batch rule for the "still faint" notice', () => {
  const setup = (tape: SynthTape): DarkroomState => reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape), progress(tape, 0.5, 1)] }, 1000);
  const tick = (s: DarkroomState, now: number): DarkroomState => reduceDarkroom(s, { type: 'tick' }, now);

  it('never shows faint when the same batch holds a complete for the tape', () => {
    fc.assert(
      fc.property(tapesArb, fc.array(fc.integer({ min: 0, max: 5000 }), { maxLength: 4 }), (tapes, dts) => {
        const tape = tapes[0];
        let s = reduceDarkroom(setup(tape), { type: 'batch', events: [passComplete(tape, 1), complete(tape, 1)] }, 2000);
        expect(s.pendingFaint).toBeUndefined();
        expect(s.notice).toBeUndefined();
        for (const dt of dts) {
          s = tick(s, 2000 + dt);
          expect(s.notice).toBeUndefined();
        }
      }),
      fcUi(),
    );
  });

  it('shows faint on the first tick at least FAINT_GRACE_MS after the batch, not before', () => {
    fc.assert(
      fc.property(tapesArb, fc.integer({ min: 0, max: FAINT_GRACE_MS - 1 }), fc.integer({ min: 0, max: 3000 }), (tapes, early, late) => {
        const tape = tapes[0];
        const t0 = 2000;
        const s = reduceDarkroom(setup(tape), { type: 'batch', events: [passComplete(tape, 1)] }, t0);
        expect(s.phase).toBe('between');
        expect(s.notice).toBeUndefined();
        expect(nextWakeMs(s, t0)).toBe(FAINT_GRACE_MS);
        expect(nextWakeMs(s, t0 + early)).toBe(FAINT_GRACE_MS - early);
        expect(tick(s, t0 + early).notice).toBeUndefined();
        const shown = tick(s, t0 + FAINT_GRACE_MS + late);
        expect(shown.notice).toBe('faint');
        expect(shown.pendingFaint).toBeUndefined();
        expect(nextWakeMs(shown, t0 + FAINT_GRACE_MS + late)).toBeUndefined();
      }),
      fcUi(),
    );
  });

  it('a complete in a later batch within the grace cancels it', () => {
    fc.assert(
      fc.property(tapesArb, fc.integer({ min: 0, max: FAINT_GRACE_MS - 1 }), fc.integer({ min: 0, max: 3000 }), (tapes, within, later) => {
        const tape = tapes[0];
        const t0 = 2000;
        let s = reduceDarkroom(setup(tape), { type: 'batch', events: [passComplete(tape, 1)] }, t0);
        s = reduceDarkroom(s, { type: 'batch', events: [complete(tape, 2)] }, t0 + within);
        expect(s.phase).toBe('fixing');
        expect(s.pendingFaint).toBeUndefined();
        expect(tick(s, t0 + FAINT_GRACE_MS + later).notice).toBeUndefined();
      }),
      fcUi(),
    );
  });

  it('two coalesced batches are judged one by one', () => {
    fc.assert(
      fc.property(tapesArb, (tapes) => {
        const tape = tapes[0];
        const s = reduceBatches(setup(tape), [[passComplete(tape, 1)], [complete(tape, 1)]], 2000);
        expect(s.phase).toBe('fixing');
        expect(s.pendingFaint).toBeUndefined();
      }),
      fcUi(),
    );
  });
});

// ---- P11 -------------------------------------------------------------------------------

describe('P11 countdown, clarity and pass display', () => {
  /** Stub of the displayed countdown until timeline.ts (task 2.4): whole seconds, rounded up, never below 0. */
  const remaining = (a: { remainingSec: number; atMs: number }, now: number): number => Math.max(0, Math.ceil(a.remainingSec - (now - a.atMs) / 1000));

  it('header sets the anchor to the estimate; progress sets it to estimate * (1 - f)', () => {
    fc.assert(
      fc.property(tapesArb, fc.integer({ min: 0, max: 600 }), fc.integer({ min: 1, max: 9 }), fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 4 }), (tapes, est, pass, fractions) => {
        const tape = tapes[0];
        let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape, pass, est)] }, 1000);
        expect(s.pass).toBe(pass);
        expect(s.countdown).toEqual({ remainingSec: est, atMs: 1000, running: true });
        fractions.forEach((f, k) => {
          s = reduceDarkroom(s, { type: 'batch', events: [progress(tape, f, k)] }, 2000 + k * 100);
          expect(s.countdown).toEqual({ remainingSec: est * (1 - f), atMs: 2000 + k * 100, running: true });
          expect(s.pass).toBe(pass);
        });
      }),
      fcUi(),
    );
  });

  it('the displayed countdown is a whole number, never below 0 and non-increasing', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 700, noNaN: true }), fc.integer({ min: 0, max: 10_000 }), fc.nat(100_000), fc.nat(100_000), (rem, atMs, d1, d2) => {
        const a = { remainingSec: rem, atMs };
        const [t1, t2] = d1 <= d2 ? [atMs + d1, atMs + d2] : [atMs + d2, atMs + d1];
        const r1 = remaining(a, t1);
        const r2 = remaining(a, t2);
        expect(Number.isInteger(r1) && Number.isInteger(r2)).toBe(true);
        expect(Math.min(r1, r2)).toBeGreaterThanOrEqual(0);
        expect(r2).toBeLessThanOrEqual(r1);
      }),
      fcUi(),
    );
  });

  it('clarity comes only from pass-complete, as round(clarity * 100), and nothing else changes it', () => {
    fc.assert(
      fc.property(tapesArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), reasonArb, (tapes, c1, c2, reason) => {
        const tape = tapes[0];
        let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape, 1), progress(tape, 0.6, 1)] }, 100);
        expect(s.clarityPct).toBeUndefined(); // R10.6
        s = reduceDarkroom(s, { type: 'batch', events: [passComplete(tape, 1, { clarity: c1, blocksRecovered: 2, blocksTotal: 5 })] }, 200);
        expect(s.clarityPct).toBe(Math.round(c1 * 100));
        expect(s.clarityPct).toBeGreaterThanOrEqual(0);
        expect(s.clarityPct).toBeLessThanOrEqual(100);
        expect(s.clarityIsPrevious).toBe(false);
        expect(s.parts).toEqual({ recovered: 2, total: 5 });
        const pct1 = s.clarityPct;

        // Second pass: the old value stays, labelled previous, through header, progress and a discard.
        s = reduceDarkroom(s, { type: 'batch', events: [header(tape, 2)] }, 300);
        expect([s.clarityPct, s.clarityIsPrevious]).toEqual([pct1, true]);
        s = reduceDarkroom(s, { type: 'batch', events: [progress(tape, 0.4, 2)] }, 310);
        expect([s.clarityPct, s.clarityIsPrevious]).toEqual([pct1, true]);
        const discarded = reduceDarkroom(s, { type: 'batch', events: [{ type: 'pass-discarded', reason }] }, 320);
        expect(discarded.clarityPct).toBe(pct1);
        expect(discarded.parts).toEqual({ recovered: 2, total: 5 });
        expect(discarded.pass).toBe(2);

        s = reduceDarkroom(s, { type: 'batch', events: [passComplete(tape, 2, { clarity: c2 })] }, 400);
        expect(s.clarityPct).toBe(Math.round(c2 * 100));
        expect(s.clarityIsPrevious).toBe(false);
      }),
      fcUi(),
    );
  });

  it('played-N-times is passesUsed of the complete event and stays fixed afterwards', () => {
    fc.assert(
      fc.property(tapesArb, fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }), (tapes, used, other) => {
        const tape = tapes[0];
        let s = reduceDarkroom(initialDarkroom(), { type: 'batch', events: [header(tape), progress(tape, 1, 0)] }, 10);
        s = reduceDarkroom(s, { type: 'batch', events: [complete(tape, used)] }, 20);
        expect(s.passesUsed).toBe(used);
        s = reduceDarkroom(s, { type: 'batch', events: [complete(tape, other), header(tape, 9)] }, 30);
        expect(s.passesUsed).toBe(used);
        expect(s.phase).toBe('fixing');
        expect(reduceDarkroom(s, { type: 'tick' }, 20 + FIX_TOTAL_MS).phase).toBe('developed');
      }),
      fcUi(),
    );
  });
});
