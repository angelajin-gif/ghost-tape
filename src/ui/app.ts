// Boot: tokens and shell styles, the shell, the router. The service worker registration and the
// reduced-motion store named in design.md join this file in their own tasks.
import './tokens.css';
import './shell.css';
import { createRouter, type Router } from './router';
import { createShell, type Shell } from './shell';

export interface App {
  readonly shell: Shell;
  readonly router: Router;
}

/** Builds the page inside `root` and renders the route for the current URL. */
export async function boot(root: HTMLElement, win: Window & typeof globalThis = window): Promise<App> {
  const shell = createShell(win.document, root);
  const router = createRouter({ win, view: shell });
  await router.start();
  return { shell, router };
}
