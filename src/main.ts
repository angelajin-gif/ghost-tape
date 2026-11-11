// Browser entry. The dev harness (src/ui/dev.ts, task 15) and the Ghost Tape UI
// (ghost-tape-ui spec) mount here later.
const app = document.querySelector<HTMLElement>('#app');
if (app) {
  app.textContent = 'Ghost Tape — a letter hidden in sound.';
}
