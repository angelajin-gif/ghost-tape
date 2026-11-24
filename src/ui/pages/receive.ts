// Receive route stub (the shell renders the heading). Listening and upload come in a later task.
import type { RouteModule } from '../routes';

export const route: RouteModule = {
  mount(host) {
    host.replaceChildren();
  },
  unmount() {
    // Later: stop the microphone and playback within 500 ms [R30.7].
  },
};
