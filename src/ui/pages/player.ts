// Tape-player route stub (the shell renders the heading). The player comes in a later task.
import type { RouteModule } from '../routes';

export const route: RouteModule = {
  mount(host) {
    host.replaceChildren();
  },
  unmount() {
    // Later: stop playback within 500 ms [R30.7].
  },
};
