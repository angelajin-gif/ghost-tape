// Router: History API, no framework [R30.2]. `matchRoute` is pure and total; the rest wires
// links, back/forward and unmount hooks. Design.md section 8.
import { ROUTES, routeById, type RouteDef, type RouteId, type RouteModule } from './routes';

export interface RouteMatch {
  readonly id: RouteId;
  /** True when the path matched none of the five routes; the route is then home [R30.5]. */
  readonly notFound: boolean;
}

/** Trailing slashes do not matter. A path that is empty after trimming is the root. */
function normalise(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

const PATH_TO_ID: ReadonlyMap<string, RouteId> = new Map([
  ...ROUTES.map((r): [string, RouteId] => [r.path, r.id]),
  // Static hosts serve the app at /index.html too; it is the home route, not a miss.
  ['/index.html', 'home'],
]);

/** Total: any string gives a match, nothing throws. Case-sensitive, like the host. */
export function matchRoute(pathname: string): RouteMatch {
  const id = PATH_TO_ID.get(normalise(pathname));
  return id === undefined ? { id: 'home', notFound: true } : { id, notFound: false };
}

/** What the router needs from the shell. */
export interface RouterView {
  /** Shows the route's heading and an empty content host; returns the host. */
  show(route: RouteDef, options: { readonly notFound: boolean; readonly moveFocus: boolean }): HTMLElement;
  /** An error state with a retry control and the navigation still visible [R30.6]. */
  showError(retry: () => void): void;
}

export interface Router {
  /** Renders the route for the current URL. */
  start(): Promise<void>;
  /** Pushes `href` and renders it. Resolves when the route is mounted or has failed. */
  navigate(href: string): Promise<void>;
  dispose(): void;
}

export interface RouterOptions {
  readonly win: Window & typeof globalThis;
  readonly view: RouterView;
  readonly routes?: readonly RouteDef[];
}

export function createRouter(options: RouterOptions): Router {
  const { win, view } = options;
  const routes = options.routes ?? ROUTES;
  let token = 0;
  let current: RouteModule | null = null;
  let renderedPathname: string | null = null;

  /** Unmounts the visible route at once, before any new route is loaded [R30.7]. */
  function leave(): void {
    const module = current;
    current = null;
    try {
      module?.unmount();
    } catch {
      // A failing unmount must not trap the visitor on this route.
    }
  }

  async function render(pathname: string, moveFocus: boolean): Promise<void> {
    const match = matchRoute(pathname);
    if (match.notFound) win.history.replaceState(null, '', '/');
    const def = routeById(match.id, routes);
    const mine = ++token;
    renderedPathname = win.location.pathname;
    leave();
    const host = view.show(def, { notFound: match.notFound, moveFocus });
    const retry = (): void => void render(pathname, true);
    try {
      const module = await def.loader();
      if (mine !== token) return;
      // Set before mount: a navigation during an async mount still unmounts this module.
      current = module;
      await module.mount(host);
    } catch {
      if (mine === token) view.showError(retry);
    }
  }

  function onClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const origin = event.target instanceof win.Element ? event.target.closest('a[href]') : null;
    if (!(origin instanceof win.HTMLAnchorElement)) return;
    const target = origin.getAttribute('target');
    if ((target !== null && target !== '_self') || origin.hasAttribute('download')) return;
    const url = new URL(origin.href, win.location.href);
    if (url.origin !== win.location.origin || matchRoute(url.pathname).notFound) return;
    if (url.pathname === win.location.pathname && url.hash !== win.location.hash) return; // in-page anchor
    event.preventDefault();
    if (url.pathname + url.search + url.hash === win.location.pathname + win.location.search + win.location.hash) return;
    void navigate(url.pathname + url.search + url.hash);
  }

  function onPopState(): void {
    // A hash-only history entry changes nothing about the route.
    if (win.location.pathname === renderedPathname && !matchRoute(win.location.pathname).notFound) return;
    void render(win.location.pathname, true);
  }

  function onPageShow(event: PageTransitionEvent): void {
    // Restored from the back/forward cache after pagehide unmounted the route.
    if (event.persisted) void render(win.location.pathname, false);
  }

  const onPageHide = (): void => leave();

  win.document.addEventListener('click', onClick);
  win.addEventListener('popstate', onPopState);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);

  function navigate(href: string): Promise<void> {
    const url = new URL(href, win.location.href);
    win.history.pushState(null, '', url.pathname + url.search + url.hash);
    return render(url.pathname, true);
  }

  return {
    start: () => render(win.location.pathname, false),
    navigate,
    dispose() {
      token += 1;
      leave();
      win.document.removeEventListener('click', onClick);
      win.removeEventListener('popstate', onPopState);
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('pageshow', onPageShow);
    },
  };
}
