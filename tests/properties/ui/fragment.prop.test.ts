// Feature: ghost-tape-ui, Property 17: Fragment round trip and rejection
// Feature: ghost-tape-ui, Property 18: Link cap
// **Validates: Requirements 22.1, 22.2, 22.3, 22.4, 22.5, 22.9, 23.1, 23.2**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deserializePayload, serializePayload } from '../../../src/modem/tape';
import type { Payload } from '../../../src/modem/types';
import {
  MAX_LINK_LENGTH,
  base64urlLength,
  buildTapeLink,
  decodeFragment,
  encodeFragment,
  linkFitsCap,
} from '../../../src/ui/fragment';
import { payloadArb } from '../../support/arbitraries';
import { fcUi } from '../../support/uiRuns';

const B64 = /^[A-Za-z0-9_-]*$/;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function frag(p: Payload): string {
  const r = encodeFragment(p);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

/** A string decodes only if deserializePayload accepts its bytes; that is the stated exception. */
function acceptedByModem(f: string): boolean {
  const d = decodeFragment(f);
  return d.ok;
}

describe('P17 fragment', () => {
  it('round trips field by field; alphabet is version char plus base64url, no padding', () => {
    fc.assert(
      fc.property(payloadArb, (p) => {
        const f = frag(p);
        expect(f[0]).toBe('1');
        expect(f.slice(1)).toMatch(B64);
        expect(f).not.toContain('=');
        const d = decodeFragment(f);
        expect(d).toEqual({ ok: true, value: p });
        expect(decodeFragment('#' + f)).toEqual(d);
        const bytes = serializePayload(p);
        expect(bytes.ok && f.length - 1 === base64urlLength(bytes.value.length)).toBe(true);
      }),
      fcUi(),
    );
  });

  it('never throws and rejects arbitrary strings that are not valid payloads', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        const d = decodeFragment(s);
        if (d.ok) expect(s.length).toBeGreaterThan(1);
      }),
      fcUi(),
    );
    for (const s of ['', '#', '1', '#1']) expect(decodeFragment(s).ok).toBe(false);
  });

  it('rejects unknown versions, bad characters, length 1 mod 4', () => {
    fc.assert(
      fc.property(
        payloadArb,
        fc.constantFrom('0', '2', 'A', '-', '=', ' '),
        fc.constantFrom('=', '+', '/', ' ', '\n', 'é', '%', '.'),
        fc.nat(),
        (p, version, bad, at) => {
          const f = frag(p);
          expect(decodeFragment(version + f.slice(1)).ok).toBe(false);
          const i = 1 + (at % (f.length - 1));
          expect(decodeFragment(f.slice(0, i) + bad + f.slice(i + 1)).ok).toBe(false);
          expect(decodeFragment(f + '=').ok).toBe(false);
          // Make the text after the version character 1 mod 4 long.
          const padded = f + 'A'.repeat((1 - ((f.length - 1) % 4) + 4) % 4);
          expect((padded.length - 1) % 4).toBe(1);
          expect(decodeFragment(padded).ok).toBe(false);
        },
      ),
      fcUi(),
    );
  });

  it('random base64url text decodes only when deserializePayload accepts the bytes', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...ALPHA), { maxLength: 300 }), (cs) => {
        const f = '1' + cs.join('');
        const d = decodeFragment(f);
        if (d.ok) {
          // canonical: re-encoding gives the identical fragment
          expect(frag(d.value)).toBe(f);
        }
      }),
      fcUi(),
    );
  });

  it('mutated fragments (drop, change, append) either fail or re-encode to themselves', () => {
    fc.assert(
      fc.property(payloadArb, fc.nat(), fc.constantFrom(...ALPHA), fc.constantFrom('drop', 'change', 'append'), (p, at, c, kind) => {
        const f = frag(p);
        const i = at % f.length;
        const m = kind === 'drop' ? f.slice(0, i) + f.slice(i + 1) : kind === 'change' ? f.slice(0, i) + c + f.slice(i + 1) : f + c;
        const d = decodeFragment(m);
        if (d.ok) expect(frag(d.value)).toBe(m);
        if (m === f) expect(acceptedByModem(m)).toBe(true);
      }),
      fcUi(),
    );
  });

  it('is strict about trailing bits: the last character must be canonical', () => {
    fc.assert(
      fc.property(payloadArb, (p) => {
        const f = frag(p);
        const bytes = serializePayload(p);
        if (!bytes.ok || bytes.value.length % 3 === 0) return;
        // Flip the lowest bit of the last character: only padding bits change, bytes would not.
        const last = ALPHA.indexOf(f[f.length - 1] as string);
        const flipped = f.slice(0, -1) + (ALPHA[last ^ 1] as string);
        expect(decodeFragment(flipped).ok).toBe(false);
        expect(deserializePayload(bytes.value).ok).toBe(true);
      }),
      fcUi(),
    );
  });
});

describe('P18 link cap', () => {
  it('fits iff prefixLength + ceil(4n/3) <= 2000, over synthetic sizes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 2100 }), fc.integer({ min: 1, max: 1500 }), (originLen, n) => {
        const prefixLength = originLen + '/play#1'.length;
        expect(linkFitsCap(prefixLength, n)).toBe(prefixLength + Math.ceil((4 * n) / 3) <= MAX_LINK_LENGTH);
      }),
      fcUi(),
    );
  });

  it('buildTapeLink agrees with the cap for real payloads and long injected origins', () => {
    fc.assert(
      fc.property(payloadArb, fc.integer({ min: 10, max: 2100 }), (p, originLen) => {
        const origin = 'https://' + 'a'.repeat(Math.max(0, originLen - 8));
        const bytes = serializePayload(p);
        if (!bytes.ok) throw new Error(bytes.reason);
        const link = buildTapeLink(origin, p);
        const expected = origin.length + '/play#1'.length + base64urlLength(bytes.value.length) <= MAX_LINK_LENGTH;
        expect(link.ok).toBe(expected);
        if (link.ok) {
          expect(link.value.length).toBeLessThanOrEqual(MAX_LINK_LENGTH);
          const hash = link.value.indexOf('#');
          expect(link.value.slice(0, hash)).toBe(origin + '/play');
          expect(link.value.slice(hash + 1)).toBe(frag(p));
          expect(link.value.indexOf('#', hash + 1)).toBe(-1);
          expect(decodeFragment(link.value.slice(hash))).toEqual({ ok: true, value: p });
        } else {
          expect(link.reason).toBe('too-long');
        }
      }),
      fcUi(),
    );
  });
});
