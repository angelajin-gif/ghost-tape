// P1 and P2: layout hint round trip and consistency under corruption (ghost-tape-ui R6).

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS, serializePayload } from '../../../src/modem/tape';
import type { Tape } from '../../../src/modem/types';
import { layoutFromPayload, parseLayoutHint, type LayoutHint } from '../../../src/ui/darkroom/layoutHint';
import { LAYOUT_CONFIDENCE_MIN } from '../../../src/ui/tokens';
import { tapeArb } from '../../support/arbitraries';
import { fcUi } from '../../support/uiRuns';

const serialize = (tape: Tape): Uint8Array => {
  const r = serializePayload(tape);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

/** Expected layout computed from the tape alone (one character is one byte). */
function expectedHint(tape: Tape): LayoutHint {
  const trackLens = tape.tracks.map((t) => t.length);
  let pos = 1;
  const at = (len: number): { lenPos: number; start: number } => {
    const r = { lenPos: pos, start: pos + 1 };
    pos += 1 + len;
    return r;
  };
  const title = at(tape.title.length);
  const from = at(tape.from.length);
  const to = at(tape.to.length);
  const date = pos;
  pos += 3;
  const trackCountPos = pos;
  pos += 1;
  const tracks = trackLens.map((l) => at(l));
  const letterLenPos = pos;
  const letter = pos + 2;
  pos = letter + tape.letter.length;
  return {
    titleLen: tape.title.length,
    fromLen: tape.from.length,
    toLen: tape.to.length,
    trackLens,
    letterLen: tape.letter.length,
    offsets: {
      titleLenPos: 1,
      title: title.start,
      fromLenPos: from.lenPos,
      from: from.start,
      toLenPos: to.lenPos,
      to: to.start,
      date,
      trackCountPos,
      trackLenPos: tracks.map((t) => t.lenPos),
      tracks: tracks.map((t) => t.start),
      letterLenPos,
      letter,
      doodleFlagPos: pos,
    },
  };
}

const full = (n: number, v: number): Float32Array => new Float32Array(n).fill(v);
const ones = (n: number): Uint8Array => new Uint8Array(n).fill(1);

describe('P1: layout hint round trip', () => {
  /** **Validates: Requirements 6.1, 6.4, 6.7, 6.9** */
  it('serialized tape at confidence 1 parses to the true layout, and layoutFromPayload agrees', () => {
    fc.assert(
      fc.property(tapeArb, (tape) => {
        const bytes = serialize(tape);
        const hint = parseLayoutHint(bytes, full(bytes.length, 1), ones(bytes.length), bytes.length);
        expect(hint).toEqual(expectedHint(tape));
        expect(layoutFromPayload(tape)).toEqual(hint);
      }),
      fcUi(),
    );
  });

  it('layoutFromPayload gives no hint for a ghost or an invalid tape', () => {
    expect(layoutFromPayload({ kind: 'ghost', message: 'hello' })).toBeUndefined();
    expect(layoutFromPayload({ kind: 'tape', title: '', from: '', to: '', tracks: [], letter: '' })).toBeUndefined();
  });
});

/** Checks everything P2 promises about an accepted hint. */
function checkConsistent(hint: LayoutHint, conf: Float32Array, has: Uint8Array, payloadLength: number): void {
  expect(hint.titleLen).toBeLessThanOrEqual(LIMITS.title);
  expect(hint.fromLen).toBeLessThanOrEqual(LIMITS.from);
  expect(hint.toLen).toBeLessThanOrEqual(LIMITS.to);
  expect(hint.titleLen + hint.fromLen + hint.toLen).toBeGreaterThan(0);
  expect(hint.trackLens.length).toBeLessThanOrEqual(LIMITS.trackCount);
  for (const t of hint.trackLens) expect(t).toBeLessThanOrEqual(LIMITS.track);
  expect(hint.letterLen).toBeLessThanOrEqual(LIMITS.letter);
  const sum = hint.titleLen + hint.fromLen + hint.toLen + hint.trackLens.reduce((a, b) => a + b, 0) + hint.letterLen;
  expect(1 + 3 + 3 + 1 + hint.trackLens.length + 2 + 1 + sum).toBe(payloadLength);
  const o = hint.offsets;
  const used = [0, o.titleLenPos, o.fromLenPos, o.toLenPos, o.trackCountPos, ...o.trackLenPos, o.letterLenPos, o.letterLenPos + 1];
  for (const i of used) {
    expect(i).toBeLessThan(payloadLength);
    expect(has[i]).toBe(1);
    expect(conf[i]!).toBeGreaterThanOrEqual(LAYOUT_CONFIDENCE_MIN);
  }
  expect(o.doodleFlagPos).toBe(payloadLength - 1);
}

const confArb = fc.float({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

describe('P2: layout hint under corruption', () => {
  /** **Validates: Requirements 6.2, 6.3, 6.6, 6.10, 6.11, 6.12** */
  it('arbitrary bytes, confidences, has and payloadLength: no throw, undefined or consistent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1100 }).chain((n) =>
          fc.record({
            bytes: fc.uint8Array({ minLength: n, maxLength: n }),
            conf: fc.array(confArb, { minLength: n, maxLength: n }),
            has: fc.array(fc.constantFrom(0, 1, 1, 1), { minLength: n, maxLength: n }),
            payloadLength: fc.integer({ min: 0, max: 1100 }),
            // Bias toward tape-shaped input so accepted parses are actually exercised.
            tapeShaped: fc.boolean(),
          }),
        ),
        ({ bytes, conf, has, payloadLength, tapeShaped }) => {
          const b = Uint8Array.from(bytes);
          if (tapeShaped && b.length > 0) b[0] = 0;
          const c = Float32Array.from(conf);
          const h = Uint8Array.from(has);
          const hint = parseLayoutHint(b, c, h, payloadLength);
          if (hint !== undefined) checkConsistent(hint, c, h, payloadLength);
          if (payloadLength === 0) expect(hint).toBeUndefined();
        },
      ),
      fcUi(),
    );
  });

  it('mutations of valid serializations: no throw, undefined or consistent; unknown kind gives undefined', () => {
    const mutation = fc.record({
      index: fc.nat(),
      op: fc.constantFrom('flip', 'drop', 'lower'),
      value: fc.integer({ min: 0, max: 255 }),
      level: fc.float({ min: 0, max: Math.fround(0.59), noNaN: true }),
    });
    fc.assert(
      fc.property(tapeArb, fc.array(mutation, { maxLength: 8 }), fc.option(fc.integer({ min: 0, max: 1100 }), { nil: undefined }), (tape, muts, lengthOverride) => {
        const bytes = serialize(tape);
        const conf = full(bytes.length, 1);
        const has = ones(bytes.length);
        for (const m of muts) {
          const i = m.index % bytes.length;
          if (m.op === 'flip') bytes[i] = m.value;
          else if (m.op === 'drop') has[i] = 0;
          else conf[i] = m.level;
        }
        const payloadLength = lengthOverride ?? bytes.length;
        const hint = parseLayoutHint(bytes, conf, has, payloadLength);
        if (hint !== undefined) checkConsistent(hint, conf, has, payloadLength);
        if (has[0] === 0 || conf[0]! < LAYOUT_CONFIDENCE_MIN || bytes[0] !== 0) expect(hint).toBeUndefined();
      }),
      fcUi(),
    );
  });
});
