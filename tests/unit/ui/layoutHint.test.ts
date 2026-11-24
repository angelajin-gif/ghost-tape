// Reject rules of the layout hint parser (ghost-tape-ui R6.2, 6.6, 6.11, 6.12).

import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../../src/modem/tape';
import { parseLayoutHint } from '../../../src/ui/darkroom/layoutHint';

/** Build a serialized-tape-shaped byte array from lengths; field bytes are filler. */
function build(opts: { kind?: number; lens?: [number, number, number]; tracks?: number[]; trackCount?: number; letter?: number; flag?: number }): Uint8Array {
  const [t, f, o] = opts.lens ?? [5, 3, 3];
  const tracks = opts.tracks ?? [4];
  const letter = opts.letter ?? 10;
  const out: number[] = [opts.kind ?? 0];
  for (const n of [t, f, o]) out.push(n, ...new Array<number>(n).fill(0x41));
  out.push(0, 0, 0, opts.trackCount ?? tracks.length);
  for (const n of tracks) out.push(n, ...new Array<number>(n).fill(0x41));
  out.push((letter >> 8) & 0xff, letter & 0xff, ...new Array<number>(letter).fill(0x41), opts.flag ?? 0);
  return Uint8Array.from(out);
}

const parse = (b: Uint8Array, len = b.length, c = 1, has = 1) =>
  parseLayoutHint(b, new Float32Array(b.length).fill(c), new Uint8Array(b.length).fill(has), len);

describe('parseLayoutHint', () => {
  it('accepts a well-formed tape', () => {
    const hint = parse(build({}));
    expect(hint?.titleLen).toBe(5);
    expect(hint?.trackLens).toEqual([4]);
    expect(hint?.letterLen).toBe(10);
  });

  it('rejects lengths over the limits', () => {
    expect(parse(build({ lens: [LIMITS.title + 1, 3, 3] }))).toBeUndefined();
    expect(parse(build({ lens: [5, LIMITS.from + 1, 3] }))).toBeUndefined();
    expect(parse(build({ lens: [5, 3, LIMITS.to + 1] }))).toBeUndefined();
    expect(parse(build({ tracks: [LIMITS.track + 1] }))).toBeUndefined();
    expect(parse(build({ letter: LIMITS.letter + 1 }))).toBeUndefined();
    expect(parse(build({ letter: LIMITS.letter }))).toBeDefined();
  });

  it('rejects an all-zero name trio', () => {
    expect(parse(build({ lens: [0, 0, 0] }))).toBeUndefined();
    expect(parse(build({ lens: [0, 0, 1] }))).toBeDefined();
  });

  it('rejects a track count over 10', () => {
    expect(parse(build({ tracks: new Array<number>(11).fill(1) }))).toBeUndefined();
    expect(parse(build({ tracks: new Array<number>(10).fill(1) }))).toBeDefined();
  });

  it('rejects an unknown kind prefix', () => {
    expect(parse(build({ kind: 1 }))).toBeUndefined();
    expect(parse(build({ kind: 7 }))).toBeUndefined();
    const b = build({});
    const conf = new Float32Array(b.length).fill(1);
    conf[0] = 0.59;
    expect(parseLayoutHint(b, conf, new Uint8Array(b.length).fill(1), b.length)).toBeUndefined();
  });

  it('rejects a doodle flag that is not 0', () => {
    expect(parse(build({ flag: 1 }))).toBeUndefined();
  });

  it('rejects a sum mismatch in either direction', () => {
    const b = build({});
    expect(parse(b, b.length + 1)).toBeUndefined();
    expect(parse(b, b.length - 1)).toBeUndefined();
  });

  it('rejects payloadLength 0, below the minimum, or not an integer', () => {
    const b = build({});
    expect(parse(b, 0)).toBeUndefined();
    expect(parse(b, 11)).toBeUndefined();
    expect(parse(b, b.length + 0.5)).toBeUndefined();
    expect(parse(b, Number.NaN)).toBeUndefined();
  });

  it('rejects when a needed prefix byte is unknown, but ignores unknown field bytes', () => {
    const b = build({});
    const conf = new Float32Array(b.length).fill(1);
    const has = new Uint8Array(b.length).fill(1);
    conf[3] = 0.1; // field byte of the title: not read
    expect(parseLayoutHint(b, conf, has, b.length)).toBeDefined();
    has[1] = 0; // title length prefix
    expect(parseLayoutHint(b, conf, has, b.length)).toBeUndefined();
  });

  it('does not throw on short arrays', () => {
    expect(parseLayoutHint(new Uint8Array(2), new Float32Array(2), new Uint8Array(2), 50)).toBeUndefined();
  });
});
