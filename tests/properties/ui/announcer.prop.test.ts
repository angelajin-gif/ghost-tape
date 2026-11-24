// @vitest-environment jsdom
// Feature: ghost-tape-ui, Property 26: Announcer queue
// **Validates: Requirements 14.4, 32.4, 32.10**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createAnnouncer, createAnnouncerQueue, MAX_KEPT_ENTRIES } from '../../../src/ui/announcer';
import { fcUi } from '../../support/uiRuns';

const calls = fc.array(
  fc.record({ key: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), text: fc.string({ maxLength: 12 }) }),
  { maxLength: 40 },
);

/** What the first call of each key should have delivered, in call order. */
const firstPerKey = (list: readonly { key: string; text: string }[]): { key: string; text: string }[] => {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
};

describe('P26 announcer queue', () => {
  it('delivers each distinct key once, in call order, and drops repeats', () => {
    fc.assert(
      fc.property(calls, (list) => {
        const q = createAnnouncerQueue();
        const returned = list.map((c) => q.offer(c.key, c.text)).filter((x) => x !== null);
        expect(returned).toEqual(firstPerKey(list));
        expect(q.delivered).toEqual(firstPerKey(list));
      }),
      fcUi(),
    );
  });

  it('the live region gets one paragraph per delivered key, in order', () => {
    fc.assert(
      fc.property(calls, (list) => {
        const a = createAnnouncer(document);
        for (const c of list) a.announce(c.key, c.text);
        const expected = firstPerKey(list).map((c) => c.text);
        expect(Array.from(a.element.children, (p) => p.textContent)).toEqual(expected);
        expect(a.element.getAttribute('aria-live')).toBe('polite');
        expect(a.element.getAttribute('role')).toBe('status');
      }),
      fcUi(),
    );
  });

  it('a repeated key adds nothing even after many other keys', () => {
    const a = createAnnouncer(document);
    for (let i = 0; i < MAX_KEPT_ENTRIES + 5; i += 1) a.announce(`k${i}`, String(i));
    const before = a.element.children.length;
    a.announce('k0', 'again');
    expect(a.element.children.length).toBe(before);
  });
});
