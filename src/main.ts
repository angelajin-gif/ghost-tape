// Browser entry. The dev harness (manual trials, tasks 15–16) stays reachable at `/?dev`, in dev
// builds only: `import.meta.env.DEV` is false in production, so the branch and its import() are removed.
import { boot } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');

if (root) {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('dev')) {
    void import('./ui/dev').then((m) => m.mountDevHarness(root));
  } else {
    void boot(root);
  }
}
