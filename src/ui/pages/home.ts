// Home route stub. The demo Darkroom arrives in a later task; today it shows the introduction.
import * as copy from '../copy';
import type { RouteModule } from '../routes';

export const route: RouteModule = {
  mount(host) {
    const intro = host.ownerDocument.createElement('p');
    intro.textContent = copy.home.intro;
    host.replaceChildren(intro);
  },
  unmount() {
    // Nothing to stop yet: the demo's microphone and playback arrive with the Darkroom.
  },
};
