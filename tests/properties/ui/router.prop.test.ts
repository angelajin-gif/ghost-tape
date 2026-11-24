// Feature: ghost-tape-ui, Property 25: Route matching
// **Validates: Requirements 30.1, 30.5**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matchRoute } from '../../../src/ui/router';
import { ROUTES } from '../../../src/ui/routes';
import { fcUi } from '../../support/uiRuns';

const PATHS = ['/', '/receive', '/compose', '/play', '/broadcast'];
const trimmed = (p: string): string => p.replace(/\/+$/, '') || '/';

describe('P25 matchRoute', () => {
  it('the route table has exactly the five design paths', () => {
    expect(ROUTES.map((r) => r.path)).toEqual(PATHS);
  });

  it('returns a route or notFound for any string, never throws', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (path) => {
        const m = matchRoute(path);
        expect(ROUTES.some((r) => r.id === m.id)).toBe(true);
        if (m.notFound) expect(m.id).toBe('home');
      }),
      fcUi(),
    );
  });

  it('treats trailing slashes as the same route', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PATHS), fc.nat({ max: 4 }), (path, extra) => {
        const base = matchRoute(path);
        expect(base.notFound).toBe(false);
        expect(matchRoute(trimmed(path) + '/'.repeat(extra))).toEqual(base);
      }),
      fcUi(),
    );
  });

  it('is notFound for every path other than the five (and /index.html, which is home)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (path) => {
        const t = trimmed(path);
        fc.pre(!PATHS.includes(t) && t !== '/index.html');
        expect(matchRoute(path).notFound).toBe(true);
      }),
      fcUi(),
    );
    fc.assert(
      fc.property(fc.constantFrom(...PATHS), fc.string({ maxLength: 8 }), (path, tail) => {
        const p = path === '/' ? '/' + tail : path + tail;
        fc.pre(!PATHS.includes(trimmed(p)) && trimmed(p) !== '/index.html');
        expect(matchRoute(p).notFound).toBe(true);
      }),
      fcUi(),
    );
  });

  it('maps each of the five paths to its own route and /index.html to home', () => {
    expect(PATHS.map((p) => matchRoute(p).id)).toEqual(ROUTES.map((r) => r.id));
    expect(matchRoute('/index.html')).toEqual({ id: 'home', notFound: false });
  });
});
