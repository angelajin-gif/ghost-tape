// Darkroom timeline (ghost-tape-ui design, "Fixing moment timeline" and "Pass information"; R8, R10, R4.2).
//
// Pure functions of the state and `nowMs`. No clock is read here: the controller passes the time,
// so the same inputs always give the same frame.

import { FIX_TOTAL_MS, SAFELIGHT_DIM_MS, SAFELIGHT_FLICKER_DIP, SAFELIGHT_FLICKER_MS, WARM_FULL_MS, WARM_START_MS } from '../tokens';
import type { CountdownAnchor, DarkroomState } from './state';

const clamp01 = (x: number): number => (Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x)));

/**
 * Displayed countdown at `nowMs`: whole seconds, rounded up, never below 0 (R10.2).
 * Frozen anchors (after a discard, R10.9) return their value unchanged.
 */
export function shownRemainingSec(anchor: CountdownAnchor, nowMs: number): number {
  if (!anchor.running) return anchor.remainingSec;
  const elapsedSec = Math.max(0, nowMs - anchor.atMs) / 1000;
  return Math.max(0, Math.ceil(anchor.remainingSec - elapsedSec));
}

/** The countdown to draw, or undefined while none is showing (before a `header`, and after `complete`). */
export function countdownSec(state: Pick<DarkroomState, 'countdown'>, nowMs: number): number | undefined {
  return state.countdown ? shownRemainingSec(state.countdown, nowMs) : undefined;
}

/**
 * Progress of the Fixing moment from 0 to 1. It is 1 at `fixStartMs + FIX_TOTAL_MS`, and at once
 * under Reduced motion once the moment has started (R8.3). Before a `complete` it is 0.
 */
export function fixProgress(state: Pick<DarkroomState, 'fixStartMs'>, nowMs: number, reducedMotion = false): number {
  if (state.fixStartMs === undefined) return 0;
  if (reducedMotion) return 1;
  return clamp01((nowMs - state.fixStartMs) / FIX_TOTAL_MS);
}

export type SafelightMode = 'steady' | 'flicker' | 'dimming' | 'off';

export interface SafelightView {
  readonly mode: SafelightMode;
  /** Brightness from 0 (off) to 1 (steady on). */
  readonly level: number;
}

/**
 * Safelight at `nowMs`. One flicker after `signal-detected` (R4.2), then steady; dimming to off
 * during the Fixing moment (R8.1). Under Reduced motion the flicker is a held, dimmer state and the
 * Fixing moment turns the light off at once, so nothing changes more than once (R32.1).
 */
export function safelightView(state: DarkroomState, nowMs: number, reducedMotion = false): SafelightView {
  if (state.fixStartMs !== undefined && state.payload !== undefined) {
    if (reducedMotion) return { mode: 'off', level: 0 };
    const level = 1 - clamp01((nowMs - state.fixStartMs) / SAFELIGHT_DIM_MS);
    return level > 0 ? { mode: 'dimming', level } : { mode: 'off', level: 0 };
  }
  const until = state.safelight.flickerUntilMs;
  if (until !== undefined && nowMs < until) {
    if (reducedMotion) return { mode: 'flicker', level: 1 - SAFELIGHT_FLICKER_DIP };
    // One smooth dip: 1 -> dip -> 1 over the flicker duration, with the dip in the middle.
    const p = clamp01(1 - (until - nowMs) / SAFELIGHT_FLICKER_MS);
    return { mode: 'flicker', level: 1 - SAFELIGHT_FLICKER_DIP * Math.sin(Math.PI * p) };
  }
  return { mode: 'steady', level: 1 };
}

/** Warm white light from 0 to 1: starts at `WARM_START_MS`, full at `WARM_FULL_MS` (design table). */
export function warmLevel(state: Pick<DarkroomState, 'fixStartMs'>, nowMs: number, reducedMotion = false): number {
  if (state.fixStartMs === undefined) return 0;
  if (reducedMotion) return 1;
  return clamp01((nowMs - state.fixStartMs - WARM_START_MS) / (WARM_FULL_MS - WARM_START_MS));
}
