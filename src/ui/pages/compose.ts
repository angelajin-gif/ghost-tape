// Compose route stub (the shell renders the heading). The Composer comes in a later task.
import type { RouteModule } from '../routes';

export const route: RouteModule = {
  mount(host) {
    host.replaceChildren();
  },
  unmount() {
    // Nothing to stop.
  },
};
