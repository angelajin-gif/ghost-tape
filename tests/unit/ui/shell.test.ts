// @vitest-environment jsdom
// Task 1.4: the shell on all five paths, the nav, the not-found notice, the error state.
// Validates: Requirements 30.1, 30.4, 30.5, 30.6, 32.7
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boot, type App } from '../../../src/ui/app';
import * as copy from '../../../src/ui/copy';
import { ROUTES } from '../../../src/ui/routes';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
let app: App | undefined;
let root: HTMLElement;

async function open(path: string): Promise<void> {
  window.history.replaceState(null, '', path);
  app = await boot(root, window);
  await tick();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.querySelector<HTMLElement>('#app')!;
});

afterEach(() => {
  app?.router.dispose();
  app = undefined;
});

describe('shell on every route', () => {
  it.each(ROUTES.map((r) => [r.path, r.heading] as const))('%s renders one h1, one main and the nav', async (path, heading) => {
    await open(path);
    const h1s = root.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe(heading);
    expect(root.querySelectorAll('main')).toHaveLength(1);
    const nav = root.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe(copy.nav.label);
    const labels = Array.from(nav.querySelectorAll('a'), (a) => a.textContent);
    expect(labels).toContain(copy.nav.receive);
    expect(labels).toContain(copy.nav.compose);
    expect(root.querySelector('.gt-notice')!.hasAttribute('hidden')).toBe(true);
    expect(window.location.pathname).toBe(path);
  });

  it('marks the current route in the nav', async () => {
    await open('/receive');
    const current = Array.from(root.querySelectorAll('nav a[aria-current="page"]'), (a) => a.textContent);
    expect(current).toEqual([copy.nav.receive]);
  });

  it('exposes one polite live region and the offline and update slots', async () => {
    await open('/');
    expect(root.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
    const chip = root.querySelector<HTMLElement>('.gt-chip')!;
    expect(chip.hidden).toBe(true);
    app!.shell.setOfflineReady(true);
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe(copy.nav.offlineReady);
    let reloads = 0;
    app!.shell.showUpdate(() => (reloads += 1));
    root.querySelector<HTMLButtonElement>('.gt-update button')!.click();
    expect(reloads).toBe(1);
  });
});

describe('not-found notice', () => {
  it('shows home, the notice and the nav, replaces the URL and announces once', async () => {
    await open('/nowhere');
    expect(root.querySelector('h1')!.textContent).toBe(copy.home.heading);
    const notice = root.querySelector<HTMLElement>('.gt-notice')!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(copy.nav.notFound);
    expect(root.querySelector('nav')).not.toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(Array.from(root.querySelectorAll('[role="status"] p'), (p) => p.textContent)).toEqual([copy.nav.notFound]);
  });
});

describe('error state', () => {
  it('offers a retry control and keeps the nav (R30.6)', async () => {
    await open('/');
    app!.shell.showError(() => undefined);
    const button = root.querySelector<HTMLButtonElement>('.gt-route button')!;
    expect(button.textContent).toBe(copy.actions.tryAgain);
    expect(root.querySelector('nav a')).not.toBeNull();
  });
});
