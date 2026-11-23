// Browser entry. Until the Ghost Tape UI (ghost-tape-ui spec) exists, the page is the dev
// harness used for the manual trials (tasks 15–16).
import { mountDevHarness } from './ui/dev';

const app = document.querySelector<HTMLElement>('#app');
if (app) mountDevHarness(app);
