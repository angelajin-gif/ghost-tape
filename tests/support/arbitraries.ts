// Shared fast-check generators for valid tapes and ghosts.

import fc from 'fast-check';
import { CHARSET_CHARACTERS, LIMITS } from '../../src/modem/tape';
import type { Ghost, Payload, Tape } from '../../src/modem/types';

export const charArb = fc.constantFrom(...CHARSET_CHARACTERS);
export const letterCharArb = fc.oneof({ weight: 20, arbitrary: charArb }, { weight: 1, arbitrary: fc.constant('\n') });
export const textArb = (max: number, minLength = 0) => fc.array(charArb, { minLength, maxLength: max }).map((cs) => cs.join(''));
export const letterArb = (max: number = LIMITS.letter) => fc.array(letterCharArb, { maxLength: max }).map((cs) => cs.join(''));

export const pad2 = (n: number): string => String(n).padStart(2, '0');
export const dateArb = fc
  .date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2255, 11, 31)), noInvalidDate: true })
  .map((d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);

/** Any valid tape, up to every field limit. An absent date has no `date` key, as deserialize returns it. */
export const tapeArb: fc.Arbitrary<Tape> = fc
  .record({
    title: textArb(LIMITS.title),
    from: textArb(LIMITS.from),
    to: textArb(LIMITS.to),
    date: fc.option(dateArb, { nil: undefined }),
    tracks: fc.array(textArb(LIMITS.track), { maxLength: LIMITS.trackCount }),
    letter: letterArb(),
  })
  .filter((t) => t.title.length + t.from.length + t.to.length > 0)
  .map(({ date, ...rest }) => ({ kind: 'tape' as const, ...rest, ...(date !== undefined ? { date } : {}) }));

export const ghostArb: fc.Arbitrary<Ghost> = textArb(LIMITS.ghostMessageMax, LIMITS.ghostMessageMin).map((message) => ({ kind: 'ghost', message }));
export const payloadArb: fc.Arbitrary<Payload> = fc.oneof(tapeArb, ghostArb);

/** Small payloads (about 20–160 bytes) so each case encodes to a short, fast-to-decode track. */
export const smallTapeArb: fc.Arbitrary<Tape> = fc
  .record({
    title: textArb(12),
    from: textArb(8),
    to: textArb(8),
    date: fc.option(dateArb, { nil: undefined }),
    tracks: fc.array(textArb(14), { maxLength: 3 }),
    letter: letterArb(40),
  })
  .filter((t) => t.title.length + t.from.length + t.to.length > 0)
  .map(({ date, ...rest }) => ({ kind: 'tape' as const, ...rest, ...(date !== undefined ? { date } : {}) }));
export const smallGhostArb: fc.Arbitrary<Ghost> = textArb(40, 1).map((message) => ({ kind: 'ghost', message }));
export const smallPayloadArb: fc.Arbitrary<Payload> = fc.oneof(smallTapeArb, smallGhostArb);
