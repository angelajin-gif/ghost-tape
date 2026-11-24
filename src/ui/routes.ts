// Route table: exactly five routes [R30.1]. Paths are from design.md section 8 (D1).
// Home is in the first-load chunk; the other four are lazy import() boundaries [R33.6].
import * as copy from './copy';
import { route as homeRoute } from './pages/home';

export type RouteId = 'home' | 'receive' | 'compose' | 'player' | 'broadcast';

/** What a page module provides. `unmount` must stop microphone capture and playback [R30.7]. */
export interface RouteModule {
  mount(host: HTMLElement): void | Promise<void>;
  unmount(): void;
}

export interface RouteDef {
  readonly id: RouteId;
  readonly path: string;
  /** The text of the page's single h1. */
  readonly heading: string;
  readonly loader: () => Promise<RouteModule>;
}

export const ROUTES: readonly RouteDef[] = [
  { id: 'home', path: '/', heading: copy.home.heading, loader: () => Promise.resolve(homeRoute) },
  { id: 'receive', path: '/receive', heading: copy.receive.heading, loader: () => import('./pages/receive').then((m) => m.route) },
  { id: 'compose', path: '/compose', heading: copy.compose.heading, loader: () => import('./pages/compose').then((m) => m.route) },
  { id: 'player', path: '/play', heading: copy.player.heading, loader: () => import('./pages/player').then((m) => m.route) },
  { id: 'broadcast', path: '/broadcast', heading: copy.broadcast.heading, loader: () => import('./pages/broadcast').then((m) => m.route) },
];

export function routeById(id: RouteId, routes: readonly RouteDef[] = ROUTES): RouteDef {
  const found = routes.find((r) => r.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}
