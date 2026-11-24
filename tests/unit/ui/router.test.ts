// @vitest-environment jsdom
// Task 1.4: leaving a route unmounts it on link, back, forward and pagehide (R30.7); a failed
// route load shows an error state whose retry works (R30.6).
// Validates: Requirements 30.6, 30.7
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRouter, type Router } from '../../../src/ui/router';
import type { RouteDef, RouteModule } from '../../../src/ui/routes';
import { ROUTES } from '../../../src/ui/routes';
import { createShell } from '../../../src/ui/shell';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function recorder(log: string[], name: string): RouteModule {
  return {
    mount: () => void log.push(`mount ${name}`),
    unmount: () => void log.push(`unmount ${name}`),
  };
}

let router: Router | undefined;
let log: string[];
let failNext: boolean;

function setup(path: string): void {
  window.history.replaceState(null, '', path);
  document.body.innerHTML = '<div id="app"></div>';
  const shell = createShell(document, document.querySelector<HTMLElement>('#app')!);
  const routes: RouteDef[] = ROUTES.map((r) => ({
    ...r,
    loader: () => {
      if (failNext && r.id === 'compose') {
        failNext = false;
        return Promise.reject(new Error('offline'));
      }
      return Promise.resolve(recorder(log, r.id));
    },
  }));
  router = createRouter({ win: window, view: shell, routes });
}

beforeEach(() => {
  log = [];
  failNext = false;
});

afterEach(() => {
  router?.dispose();
  router = undefined;
});

describe('unmount hooks (R30.7)', () => {
  it('unmounts the old route synchronously when a nav link is activated', async () => {
    setup('/receive');
    await router!.start();
    document.querySelector<HTMLAnchorElement>('nav a[href="/compose"]')!.click();
    expect(log).toEqual(['mount receive', 'unmount receive']);
    await tick();
    expect(log).toEqual(['mount receive', 'unmount receive', 'mount compose']);
    expect(window.location.pathname).toBe('/compose');
  });

  it('unmounts on back and on forward', async () => {
    setup('/');
    await router!.start();
    await router!.navigate('/receive');
    log.length = 0;
    const popped = (): Promise<void> => new Promise((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    let wait = popped();
    window.history.back();
    await wait;
    await tick();
    expect(log).toEqual(['unmount receive', 'mount home']);
    log.length = 0;
    wait = popped();
    window.history.forward();
    await wait;
    await tick();
    expect(log).toEqual(['unmount home', 'mount receive']);
  });

  it('unmounts on pagehide', async () => {
    setup('/receive');
    await router!.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(log).toEqual(['mount receive', 'unmount receive']);
  });

  it('does not mount a route the visitor already left while it was loading', async () => {
    setup('/');
    await router!.start();
    void router!.navigate('/receive');
    await router!.navigate('/broadcast');
    await tick();
    expect(log.filter((l) => l.startsWith('mount'))).toEqual(['mount home', 'mount broadcast']);
  });
});

describe('route load failure (R30.6)', () => {
  it('shows a retry control that loads the route again', async () => {
    setup('/');
    await router!.start();
    failNext = true;
    await router!.navigate('/compose');
    const retry = document.querySelector<HTMLButtonElement>('.gt-route button')!;
    expect(retry).not.toBeNull();
    expect(document.querySelector('nav a')).not.toBeNull();
    retry.click();
    await tick();
    expect(log).toContain('mount compose');
  });
});
