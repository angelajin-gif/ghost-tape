// Broadcast route stub (the shell renders the heading). Side B comes in a later task.
import type { RouteModule } from '../routes';

export const route: RouteModule = {
  mount(host) {
    host.replaceChildren();
  },
  unmount() {
    // Later: stop the loop and release the wake lock.
  },
};
