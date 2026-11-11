import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CHARSET_CHARACTERS,
  deserializePayload,
  LIMITS,
  serializePayload,
  serializeWithinCap,
} from '../../src/modem/tape';
import type { Ghost, Payload, Tape } from '../../src/modem/types';
import { fcParams } from '../support/runs';

// ---------- arbitraries ----------

const charArb = fc.constantFrom(...CHARSET_CHARACTERS);
const letterCharArb = fc.oneof({ weight: 20, arbitrary: charArb }, { weight: 1, arbitrary: fc.constant('\n') });
const textArb = (max: number, minLength = 0) => fc.array(charArb, { minLength, maxLength: max }).map((cs) => cs.join(''));
const letterArb = fc.array(letterCharArb, { maxLength: LIMITS.letter }).map((cs) => cs.join(''));

const pad2 = (n: number): string => String(n).padStart(2, '0');
const dateArb = fc
  .date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2255, 11, 31)), noInvalidDate: true })
  .map((d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);

const tapeArb: fc.Arbitrary<Tape> = fc
  .record({
    title: textArb(LIMITS.title),
    from: textArb(LIMITS.from),
    to: textArb(LIMITS.to),
    date: fc.option(dateArb, { nil: undefined }),
    tracks: fc.array(textArb(LIMITS.track), { maxLength: LIMITS.trackCount }),
    letter: letterArb,
  })
  .filter((t) => t.title.length + t.from.length + t.to.length > 0)
  // Absent date = no `date` key at all, matching what deserialize returns.
  .map(({ date, ...rest }) => ({ kind: 'tape' as const, ...rest, ...(date !== undefined ? { date } : {}) }));

const ghostArb: fc.Arbitrary<Ghost> = textArb(LIMITS.ghostMessageMax, LIMITS.ghostMessageMin).map((message) => ({ kind: 'ghost', message }));
const payloadArb: fc.Arbitrary<Payload> = fc.oneof(tapeArb, ghostArb);

/** Characters that are never allowed: controls, DEL, Latin-1, emoji, lone surrogates, CJK. */
const badCharArb = fc.oneof(
  fc.integer({ min: 0x00, max: 0x1f }).filter((c) => c !== 0x0a).map((c) => String.fromCharCode(c)),
  fc.constantFrom('\x7f', 'é', 'ñ', '€', '😀', '\uD800', '你', '\u00A0', '\u2015'),
);

const serialized = (p: Payload): Uint8Array => {
  const r = serializePayload(p);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

// ---------- P10 ----------

describe('P10: deserialize(serialize(p)) = p', () => {
  it('for every valid tape and ghost; absent date stays absent; one character = one byte', () => {
    fc.assert(
      fc.property(payloadArb, (p) => {
        const bytes = serialized(p);
        expect(deserializePayload(bytes)).toStrictEqual({ ok: true, value: p });
        // Size check against the layout: one byte per character plus fixed overhead.
        if (p.kind === 'ghost') expect(bytes.length).toBe(2 + p.message.length);
        else {
          const text = p.title.length + p.from.length + p.to.length + p.tracks.reduce((n, t) => n + t.length, 0) + p.letter.length;
          expect(bytes.length).toBe(1 + 3 + 3 + 1 + p.tracks.length + 2 + 1 + text);
        }
      }),
      fcParams(50, 2000),
    );
  });

  it('round-trips the largest valid tape (1,509 bytes) and every charset mark', () => {
    const max: Tape = {
      kind: 'tape',
      title: 'T'.repeat(40),
      from: '‘’“”—…–'.padEnd(24, 'f'),
      to: 'o'.repeat(24),
      date: '2255-12-31',
      tracks: Array.from({ length: 10 }, (_, i) => String(i).repeat(60)),
      letter: 'line\n'.repeat(160),
    };
    const bytes = serialized(max);
    expect(bytes.length).toBe(1509);
    expect(deserializePayload(bytes)).toStrictEqual({ ok: true, value: max });
  });
});

// ---------- P11 ----------

const TAPE_TEXT_FIELDS = ['title', 'from', 'to', 'letter'] as const;
const baseTape: Tape = { kind: 'tape', title: 'Side A', from: 'Ana', to: 'Ben', tracks: ['One', 'Two'], letter: 'Hi' };

describe('P11: invalid input is rejected, naming the field, never thrown', () => {
  it('rejects a character outside the charset in any text field (R2.3, R2.4)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<string>(...TAPE_TEXT_FIELDS, 'track', 'message'),
        textArb(10),
        badCharArb,
        textArb(10),
        (field, before, bad, after) => {
          const value = `${before}${bad}${after}`;
          let p: Payload;
          let name: string;
          if (field === 'message') [p, name] = [{ kind: 'ghost', message: value }, 'message'];
          else if (field === 'track') [p, name] = [{ ...baseTape, tracks: ['ok', value] }, 'tracks[1]'];
          else [p, name] = [{ ...baseTape, [field]: value }, field];
          const r = serializePayload(p);
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.reason.startsWith(`${name}:`)).toBe(true);
        },
      ),
      fcParams(50, 2000),
    );
  });

  it('rejects a newline anywhere except the letter', () => {
    for (const [p, name] of [
      [{ ...baseTape, title: 'a\nb' }, 'title'],
      [{ ...baseTape, from: '\n' }, 'from'],
      [{ ...baseTape, to: 'x\n' }, 'to'],
      [{ ...baseTape, tracks: ['a\nb'] }, 'tracks[0]'],
      [{ kind: 'ghost', message: 'hi\nthere' }, 'message'],
    ] as const) {
      const r = serializePayload(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(new RegExp(`^${name.replace(/[[\]]/g, '\\$&')}: newline`));
    }
    expect(serializePayload({ ...baseTape, letter: 'a\nb' }).ok).toBe(true);
  });

  it('rejects every over-length field at exactly limit + 1 and accepts exactly the limit', () => {
    const cases: Array<[(n: number) => Payload, number, string]> = [
      [(n) => ({ ...baseTape, title: 'x'.repeat(n) }), LIMITS.title, 'title'],
      [(n) => ({ ...baseTape, from: 'x'.repeat(n) }), LIMITS.from, 'from'],
      [(n) => ({ ...baseTape, to: 'x'.repeat(n) }), LIMITS.to, 'to'],
      [(n) => ({ ...baseTape, tracks: ['x'.repeat(n)] }), LIMITS.track, 'tracks[0]'],
      [(n) => ({ ...baseTape, tracks: Array.from({ length: n }, () => 't') }), LIMITS.trackCount, 'tracks'],
      [(n) => ({ ...baseTape, letter: 'x'.repeat(n) }), LIMITS.letter, 'letter'],
      [(n) => ({ kind: 'ghost', message: 'x'.repeat(n) }), LIMITS.ghostMessageMax, 'message'],
    ];
    for (const [make, limit, name] of cases) {
      expect(serializePayload(make(limit)).ok, `${name} at limit`).toBe(true);
      const r = serializePayload(make(limit + 1));
      expect(r.ok, `${name} over limit`).toBe(false);
      if (!r.ok) expect(r.reason.startsWith(`${name}:`)).toBe(true);
    }
  });

  it('counts the seven marks as one character each', () => {
    expect(serializePayload({ ...baseTape, title: '…'.repeat(40) }).ok).toBe(true);
    expect(serializePayload({ ...baseTape, title: '…'.repeat(41) }).ok).toBe(false);
  });

  it('rejects an empty ghost message', () => {
    const r = serializePayload({ kind: 'ghost', message: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.startsWith('message:')).toBe(true);
  });

  it('rejects title, from and to all empty, and accepts any one or two empty (R2.8)', () => {
    const r = serializePayload({ ...baseTape, title: '', from: '', to: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/title, from and to/);
    for (const filled of [{ title: 'a' }, { from: 'a' }, { to: 'a' }, { title: 'a', to: 'b' }]) {
      expect(serializePayload({ ...baseTape, title: '', from: '', to: '', ...filled }).ok).toBe(true);
    }
  });

  it('accepts a date exactly when it is a real Gregorian date in 2000-01-01..2255-12-31 (R2.7)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1990, max: 2265 }), fc.integer({ min: 0, max: 13 }), fc.integer({ min: 0, max: 32 }), (y, m, d) => {
        const date = `${y}-${pad2(m)}-${pad2(d)}`;
        // Independent oracle: the JS Date round trip.
        const js = new Date(Date.UTC(y, m - 1, d));
        const real = m >= 1 && m <= 12 && d >= 1 && js.getUTCFullYear() === y && js.getUTCMonth() === m - 1 && js.getUTCDate() === d;
        const valid = real && y >= 2000 && y <= 2255;
        const r = serializePayload({ ...baseTape, date });
        expect(r.ok, date).toBe(valid);
        if (!r.ok) expect(r.reason.startsWith('date:')).toBe(true);
      }),
      fcParams(50, 5000),
    );
  });

  it('rejects malformed and out-of-range dates by name', () => {
    for (const date of ['2025-02-29', '2024-04-31', '1999-12-31', '2256-01-01', '2024-1-01', '2024-13-01', '2024-00-10', '20240101', 'abcd', '']) {
      const r = serializePayload({ ...baseTape, date });
      expect(r.ok, date).toBe(false);
      if (!r.ok) expect(r.reason.startsWith('date:')).toBe(true);
    }
    expect(serializePayload({ ...baseTape, date: '2024-02-29' }).ok).toBe(true);
    expect(serializePayload({ ...baseTape, date: '2000-01-01' }).ok).toBe(true);
  });

  it('enforces the profile cap with a reason stating cap and actual size (R1.2)', () => {
    const big: Tape = { ...baseTape, letter: 'x'.repeat(300) };
    const size = serialized(big).length;
    const r = serializeWithinCap(big, 256, 'robust');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('256');
      expect(r.reason).toContain(String(size));
    }
    expect(serializeWithinCap(big, 1024, 'standard').ok).toBe(true);
  });

  it('rejects doodles until the doodle task ships (R2.2)', () => {
    expect(serializePayload({ ...baseTape, doodle: new Uint8Array(128) }).ok).toBe(false);
  });

  it('random bytes never throw and only decode when they are the canonical encoding', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1600 }), (bytes) => {
        const r = deserializePayload(bytes);
        if (r.ok) expect(serialized(r.value)).toEqual(bytes);
      }),
      fcParams(50, 5000),
    );
  });

  it('a valid encoding with one byte changed either fails or is itself canonical (no silent repair)', () => {
    fc.assert(
      fc.property(
        payloadArb.chain((p) => {
          const bytes = serialized(p);
          return fc.tuple(fc.constant(bytes), fc.nat({ max: bytes.length - 1 }), fc.integer({ min: 1, max: 255 }));
        }),
        ([bytes, index, xor]) => {
          const mutated = bytes.slice();
          mutated[index]! ^= xor;
          const r = deserializePayload(mutated);
          if (r.ok) expect(serialized(r.value)).toEqual(mutated);
        },
      ),
      fcParams(50, 5000),
    );
  });

  it('rejects a text byte outside the charset or a misplaced newline on decode (R2.9)', () => {
    const bytes = serialized(baseTape); // kind, len 6 "Side A", ...
    for (const bad of [0x00, 0x09, 0x0d, 0x1f, 0x7f, 0x87, 0xa0, 0xff, 0x0a]) {
      const mutated = bytes.slice();
      mutated[2] = bad; // first character of the title
      expect(deserializePayload(mutated).ok, `byte 0x${bad.toString(16)}`).toBe(false);
    }
  });

  it('rejects truncation and trailing bytes', () => {
    const bytes = serialized(baseTape);
    for (let n = 0; n < bytes.length; n++) expect(deserializePayload(bytes.subarray(0, n)).ok).toBe(false);
    expect(deserializePayload(Uint8Array.of(...bytes, 0)).ok).toBe(false);
  });
});
