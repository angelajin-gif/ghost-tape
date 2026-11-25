// The single decision point for Developed text (ghost-tape-ui design, "Hidden, then revealed"; R8.2, R11, R14.1).
//
// Views read only this. `text` has the type `Payload`, and the reducer only ever stores a
// `Payload` taken from a `complete` event, so no provisional byte can reach the DOM text.

import type { Payload } from '../../modem/types';
import type { DarkroomState } from './state';

export interface DevelopedView {
  /** Written to the DOM (visually hidden until `revealed`). Set iff the phase is `fixing` or `developed`. */
  readonly text: Payload | undefined;
  /** "Save as image" and "Reply with a tape" are enabled iff there is text (R11.5, R11.8). */
  readonly controlsEnabled: boolean;
  readonly label: 'not-yet' | 'developed';
  /** True when the Developed text is shown and the Glyph layer is removed. */
  readonly revealed: boolean;
}

export interface DevelopedViewOptions {
  /**
   * Under Reduced motion the end state applies in one frame (R8.3), so the text is revealed in
   * the frame that processes `complete` instead of waiting for the `developed` phase.
   */
  readonly reducedMotion?: boolean;
}

export function developedView(state: DarkroomState, options: DevelopedViewOptions = {}): DevelopedView {
  const fixed = state.phase === 'fixing' || state.phase === 'developed';
  const text = fixed ? state.payload : undefined;
  const revealed = text !== undefined && (state.phase === 'developed' || options.reducedMotion === true);
  return { text, controlsEnabled: text !== undefined, label: text !== undefined ? 'developed' : 'not-yet', revealed };
}
