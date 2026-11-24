// The page frame, the same on every route: navigation with Receive and Compose [R30.4], one h1,
// the main landmark, the not-found notice [R30.5], an error state with a next action [R30.6],
// and slots for the offline-ready chip and the update notice (filled by the service worker task).
import { createAnnouncer, type Announcer } from './announcer';
import * as copy from './copy';
import type { RouterView } from './router';
import { ROUTES, type RouteDef, type RouteId } from './routes';

export interface Shell extends RouterView {
  readonly root: HTMLElement;
  readonly announcer: Announcer;
  setOfflineReady(ready: boolean): void;
  /** Shows the update notice with a Reload control; applying is the caller's job [R31.5]. */
  showUpdate(onReload: () => void): void;
}

/** Routes that appear in the navigation. The tape-player is reached by a shared link, not the nav. */
const NAV: readonly { readonly id: RouteId; readonly label: string }[] = [
  { id: 'home', label: copy.nav.home },
  { id: 'receive', label: copy.nav.receive },
  { id: 'compose', label: copy.nav.compose },
  { id: 'broadcast', label: copy.nav.broadcast },
];

export function createShell(doc: Document, mountPoint: HTMLElement): Shell {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  };

  const root = el('div', 'gt-shell');
  const header = el('header', 'gt-header');
  const nav = el('nav', 'gt-nav');
  nav.setAttribute('aria-label', copy.nav.label);
  const links = new Map<RouteId, HTMLAnchorElement>();
  for (const item of NAV) {
    const link = el('a', 'gt-link');
    link.href = ROUTES.find((r) => r.id === item.id)?.path ?? '/';
    link.textContent = item.label;
    links.set(item.id, link);
    nav.append(link);
  }
  const chip = el('span', 'gt-chip');
  chip.textContent = copy.nav.offlineReady;
  chip.hidden = true;
  header.append(nav, chip);

  const update = el('div', 'gt-update');
  update.hidden = true;

  const main = el('main', 'gt-main');
  main.id = 'main';
  const heading = el('h1', 'gt-heading');
  heading.tabIndex = -1; // focus target after a navigation, not a tab stop
  const notice = el('p', 'gt-notice');
  notice.hidden = true;
  const content = el('div', 'gt-route');
  main.append(heading, notice, content);

  const announcer = createAnnouncer(doc);
  root.append(header, update, main, announcer.element);
  mountPoint.replaceChildren(root);

  let notFoundCount = 0;

  return {
    root,
    announcer,
    show(route: RouteDef, options): HTMLElement {
      heading.textContent = route.heading;
      doc.title = copy.app.documentTitle(route.heading);
      for (const [id, link] of links) {
        if (id === route.id && !options.notFound) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      notice.hidden = !options.notFound;
      notice.textContent = options.notFound ? copy.nav.notFound : '';
      if (options.notFound) {
        notFoundCount += 1;
        const key = `not-found:${notFoundCount}`; // a new key each time, so a second miss is announced too
        announcer.announce(key, copy.nav.notFound);
      }
      content.replaceChildren();
      if (options.moveFocus) heading.focus();
      return content;
    },
    showError(retry: () => void): void {
      const message = el('p', 'gt-error');
      message.textContent = copy.nav.routeFailed;
      const again = el('button', 'gt-button');
      again.type = 'button';
      again.textContent = copy.actions.tryAgain;
      again.addEventListener('click', retry);
      content.replaceChildren(message, again);
    },
    setOfflineReady(ready: boolean): void {
      chip.hidden = !ready;
    },
    showUpdate(onReload: () => void): void {
      const message = el('span', 'gt-update-text');
      message.textContent = copy.nav.updateAvailable;
      const reload = el('button', 'gt-button');
      reload.type = 'button';
      reload.textContent = copy.nav.updateAction;
      reload.addEventListener('click', onReload);
      update.replaceChildren(message, reload);
      update.hidden = false;
    },
  };
}
