// Darkroom state (ghost-tape-ui design, "The darkroom state machine"; R4 to R11, R13).
//
// Pure data. Every string here is a key (notice keys, layout names), never English text
// (R38.2): copy.ts maps keys to words. Typed arrays are treated as immutable once a state
// has been returned by the reducer; the reducer clones before it writes (copy on first write).

import type { Payload } from '../../modem/types';
import type { notices } from '../copy';
import type { Glyphs } from './glyphs';
import type { SymbolHistory } from './history';
import type { LayoutHint } from './layoutHint';

export type DarkroomPhase = 'empty' | 'receiving' | 'between' | 'fixing' | 'developed';

/** What the Kind byte says (R5). `invalid` is a confident byte other than 0 or 1. */
export type KindReading = 'unknown' | 'tape' | 'ghost' | 'invalid';

/** Which sheet geometry the Paper uses. Only a tape with an accepted hint gets the J-card sheet. */
export type SheetLayout = 'generic' | 'jcard' | 'single-line';

/** Reasons the UI shows a one-line notice. The view maps each key to a `copy.notices` key. */
export type NoticeKey = 'faint' | 'header-invalid' | 'alignment-failed' | 'signal-lost' | 'already-received';

/** Key of `copy.notices` for each notice key. Types only; the words live in copy.ts. */
export const NOTICE_COPY_KEY: Readonly<Record<NoticeKey, keyof typeof notices>> = {
  faint: 'stillFaint',
  'header-invalid': 'headerInvalid',
  'alignment-failed': 'alignmentFailed',
  'signal-lost': 'signalLost',
  'already-received': 'alreadyReceived',
};

/** The sheet in the tray: provisional glyphs plus everything derived from them. */
export interface Paper {
  readonly tapeId: number;
  readonly payloadLength: number;
  readonly glyphs: Glyphs;
  readonly history: SymbolHistory;
  readonly kind: KindReading;
  readonly hint: LayoutHint | undefined;
  readonly sheet: SheetLayout;
}

/**
 * Countdown anchor (design "Pass information"): the displayed value at time t is
 * `max(0, ceil(remainingSec - (t - atMs) / 1000))` while `running`, and `remainingSec` when frozen.
 */
export interface CountdownAnchor {
  readonly remainingSec: number;
  readonly atMs: number;
  readonly running: boolean;
}

export interface PartsRecovered {
  readonly recovered: number;
  readonly total: number;
}

/** What a discarded pass restores (R9.6): the Paper and the per-tape results as they were before the `header`. */
export interface Checkpoint {
  readonly paper: Paper;
  readonly clarityPct: number | undefined;
  readonly clarityIsPrevious: boolean;
  readonly parts: PartsRecovered | undefined;
}

export interface PendingFaint {
  readonly tapeId: number;
  readonly sinceMs: number;
}

export interface SafelightState {
  /** End of the single flicker (R4.2), or undefined when the Safelight is steady. */
  readonly flickerUntilMs: number | undefined;
  /** A `signal-detected` arrived and no `header` since: a discard restores the steady state (R9.9). */
  readonly signalPending: boolean;
}

export interface DarkroomState {
  readonly phase: DarkroomPhase;
  readonly paper: Paper | undefined;
  readonly checkpoint: Checkpoint | undefined;
  /** True from `header` until the pass ends or is discarded (the "in-progress marker", R9.7). */
  readonly passInProgress: boolean;
  readonly pass: number | undefined;
  /** `estimatedSecondsRemaining` of the last `header`; `progress` scales it by `1 - fractionReceived`. */
  readonly estimateSec: number | undefined;
  readonly countdown: CountdownAnchor | undefined;
  /** `round(clarity * 100)` of the latest `pass-complete` of this tape (R10.4). */
  readonly clarityPct: number | undefined;
  /** True from the next `header` until the next `pass-complete`: the value is from the previous pass (R10.7). */
  readonly clarityIsPrevious: boolean;
  readonly parts: PartsRecovered | undefined;
  /** `passesUsed` of the `complete` event (R10.8). */
  readonly passesUsed: number | undefined;
  /** Verified payload; set only together with phase `fixing`. */
  readonly payload: Payload | undefined;
  readonly fixStartMs: number | undefined;
  /** R8.7: a `complete` whose payload cannot be laid out. Nothing is fixed. */
  readonly unreadable: boolean;
  readonly notice: NoticeKey | undefined;
  readonly pendingFaint: PendingFaint | undefined;
  readonly safelight: SafelightState;
}

export function initialDarkroom(): DarkroomState {
  return {
    phase: 'empty',
    paper: undefined,
    checkpoint: undefined,
    passInProgress: false,
    pass: undefined,
    estimateSec: undefined,
    countdown: undefined,
    clarityPct: undefined,
    clarityIsPrevious: false,
    parts: undefined,
    passesUsed: undefined,
    payload: undefined,
    fixStartMs: undefined,
    unreadable: false,
    notice: undefined,
    pendingFaint: undefined,
    safelight: { flickerUntilMs: undefined, signalPending: false },
  };
}
