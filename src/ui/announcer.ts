// Polite live-region announcer [R32.4, R32.10, R14.4].
// The queue is pure: it decides which calls are delivered. The DOM part appends one <p> per
// delivered call to a visually hidden role="status" region. Screen readers read appended nodes in
// order, so nothing is dropped or interrupted while another announcement is pending.

export interface Announcement {
  readonly key: string;
  readonly text: string;
}

export interface AnnouncerQueue {
  /** Returns the announcement to deliver, or null when `key` was already delivered. */
  offer(key: string, text: string): Announcement | null;
  /** Everything delivered so far, in call order. */
  readonly delivered: readonly Announcement[];
}

/** Keyed de-duplication: the first call for a key is delivered, later calls with that key are not. */
export function createAnnouncerQueue(): AnnouncerQueue {
  const seen = new Set<string>();
  const delivered: Announcement[] = [];
  return {
    offer(key, text) {
      if (seen.has(key)) return null;
      seen.add(key);
      const item: Announcement = { key, text };
      delivered.push(item);
      return item;
    },
    delivered,
  };
}

/** Entries kept in the live region before old ones may be pruned. */
export const MAX_KEPT_ENTRIES = 20;
/** Pruning waits this long after an announcement so a slow screen reader can still reach it. */
export const PRUNE_AFTER_MS = 10_000;

export interface Announcer {
  /** `key` names the event (for example `complete:<tapeId>`); a repeated key adds nothing. */
  announce(key: string, text: string): void;
  readonly element: HTMLElement;
}

export function createAnnouncer(doc: Document): Announcer {
  const queue = createAnnouncerQueue();
  const element = doc.createElement('div');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.className = 'gt-announcer';

  const prune = (): void => {
    while (element.children.length > MAX_KEPT_ENTRIES) element.firstElementChild?.remove();
  };

  return {
    element,
    announce(key, text) {
      const item = queue.offer(key, text);
      if (item === null) return;
      const entry = doc.createElement('p');
      entry.textContent = item.text;
      element.append(entry);
      if (element.children.length > MAX_KEPT_ENTRIES) setTimeout(prune, PRUNE_AFTER_MS);
    },
  };
}
