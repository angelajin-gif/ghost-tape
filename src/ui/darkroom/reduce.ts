// The darkroom reducer (ghost-tape-ui design, "The darkroom state machine"; R4 to R10, R13).
//
// Pure: `nowMs` is an argument, there is no clock, no randomness, no DOM. The only inputs are
// decoder event batches, `tick` (time passed) and `reset`, so no animation can start from
// anything but a real event (R4.10). Arrays are cloned on the first write within one call
// (copy on first write), never per event, so a coalesced frame costs one clone.

import { serializePayload } from '../../modem/tape';
import type { DecoderEvent, DiscardReason } from '../../modem/types';
import { FAINT_GRACE_MS, FIX_TOTAL_MS, SAFELIGHT_FLICKER_MS } from '../tokens';
import { detectKind } from './kind';
import { cloneHistory, createHistory, recordValue } from './history';
import { layoutFromPayload, parseLayoutHint } from './layoutHint';
import type { Glyphs } from './glyphs';
import type { SymbolHistory } from './history';
import {
  initialDarkroom,
  type Checkpoint,
  type CountdownAnchor,
  type DarkroomState,
  type NoticeKey,
  type Paper,
} from './state';

export type DarkroomInput =
  /** One `push()` or `flush()` result. */
  | { readonly type: 'batch'; readonly events: readonly DecoderEvent[] }
  /** Time passed, nothing else. */
  | { readonly type: 'tick' }
  /** "Start over" or a new file. */
  | { readonly type: 'reset' };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DISCARD_NOTICE: Readonly<Record<DiscardReason, NoticeKey>> = {
  'header-invalid': 'header-invalid',
  'alignment-failed': 'alignment-failed',
  'signal-lost': 'signal-lost',
};

const clamp01 = (x: number): number => (Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x)));
const nonNegative = (x: number): number => (Number.isFinite(x) && x > 0 ? x : 0);

/** Displayed countdown at `nowMs` (whole seconds, rounded up, never below 0). Task 2.4 owns the public version in timeline.ts. */
function shownRemainingSec(a: CountdownAnchor, nowMs: number): number {
  if (!a.running) return a.remainingSec;
  const elapsedSec = Math.max(0, nowMs - a.atMs) / 1000;
  return Math.max(0, Math.ceil(a.remainingSec - elapsedSec));
}

// ---- Working copy ----------------------------------------------------------------------

/** One reduce call's scratch space: a shallow draft of the state plus ownership flags for the typed arrays. */
interface Work {
  readonly original: DarkroomState;
  s: Mutable<DarkroomState>;
  paper: Mutable<Paper> | undefined;
  ownGlyphs: boolean;
  ownHistory: boolean;
  dirty: boolean;
}

function startWork(state: DarkroomState): Work {
  return { original: state, s: { ...state }, paper: state.paper ? { ...state.paper } : undefined, ownGlyphs: false, ownHistory: false, dirty: false };
}

function finish(w: Work): DarkroomState {
  if (!w.dirty) return w.original;
  return { ...w.s, paper: w.paper };
}

function set(w: Work, patch: Partial<Mutable<DarkroomState>>): void {
  Object.assign(w.s, patch);
  w.dirty = true;
}

/** An immutable view of the working paper: later writes in this call must clone the arrays first. */
function snapshotPaper(w: Work): Paper | undefined {
  if (!w.paper) return undefined;
  w.ownGlyphs = false;
  w.ownHistory = false;
  return { ...w.paper };
}

function setPaper(w: Work, paper: Paper, owned: boolean): void {
  w.paper = { ...paper };
  w.ownGlyphs = owned;
  w.ownHistory = owned;
  w.dirty = true;
}

function writableGlyphs(w: Work): Glyphs {
  const p = w.paper!;
  if (!w.ownGlyphs) {
    p.glyphs = { byte: p.glyphs.byte.slice(), conf: p.glyphs.conf.slice(), has: p.glyphs.has.slice() };
    w.ownGlyphs = true;
  }
  return p.glyphs;
}

function writableHistory(w: Work): SymbolHistory {
  const p = w.paper!;
  if (!w.ownHistory) {
    p.history = cloneHistory(p.history);
    w.ownHistory = true;
  }
  return p.history;
}

function blankPaper(tapeId: number, payloadLength: number): Paper {
  return {
    tapeId,
    payloadLength,
    glyphs: { byte: new Uint8Array(payloadLength), conf: new Float32Array(payloadLength), has: new Uint8Array(payloadLength) },
    history: createHistory(payloadLength),
    kind: 'unknown',
    hint: undefined,
    sheet: 'generic',
  };
}

// ---- Batch state -----------------------------------------------------------------------

/** What one batch has seen, for the "still faint" rule (R9.1). */
interface BatchScan {
  passEndedFor: number | undefined;
  completeFor: Set<number>;
}

const inFixedPhase = (w: Work): boolean => w.s.phase === 'fixing' || w.s.phase === 'developed';

// ---- Event handlers --------------------------------------------------------------------

function onSignalDetected(w: Work, nowMs: number): void {
  if (w.s.phase !== 'empty' && w.s.phase !== 'between') return;
  set(w, { safelight: { flickerUntilMs: nowMs + SAFELIGHT_FLICKER_MS, signalPending: true } });
}

function onHeader(w: Work, e: Extract<DecoderEvent, { type: 'header' }>, nowMs: number): void {
  if (inFixedPhase(w)) return;
  if (!Number.isInteger(e.payloadLength) || e.payloadLength < 0) return;

  const before = { clarityPct: w.s.clarityPct, clarityIsPrevious: w.s.clarityIsPrevious, parts: w.s.parts };
  const same = w.paper !== undefined && w.paper.tapeId === e.tapeId;
  let checkpointPaper: Paper;
  if (same) {
    checkpointPaper = snapshotPaper(w)!;
  } else if (w.paper) {
    // The discarded pass must leave the earlier Paper as it was (R9.3 to R9.6).
    checkpointPaper = snapshotPaper(w)!;
    setPaper(w, blankPaper(e.tapeId, e.payloadLength), true);
  } else {
    // First header: the blank Paper stays in the tray even if the pass is discarded (R9.7).
    const fresh = blankPaper(e.tapeId, e.payloadLength);
    setPaper(w, fresh, false);
    checkpointPaper = fresh;
  }
  const checkpoint: Checkpoint = { paper: checkpointPaper, ...before };

  const estimate = nonNegative(e.estimatedSecondsRemaining);
  set(w, {
    phase: 'receiving',
    checkpoint,
    passInProgress: true,
    pass: e.pass,
    estimateSec: estimate,
    countdown: { remainingSec: estimate, atMs: nowMs, running: true },
    clarityPct: same ? w.s.clarityPct : undefined,
    clarityIsPrevious: same && w.s.clarityPct !== undefined,
    parts: same ? w.s.parts : undefined,
    unreadable: false,
    notice: undefined,
    pendingFaint: undefined,
    safelight: { ...w.s.safelight, signalPending: false },
  });
}

function onProgress(w: Work, e: Extract<DecoderEvent, { type: 'progress' }>, nowMs: number): void {
  if (w.s.phase !== 'receiving' || !w.paper || w.paper.tapeId !== e.tapeId) return;
  const g = writableGlyphs(w);
  const h = writableHistory(w);
  const length = w.paper.payloadLength;
  for (const b of e.provisional) {
    if (!Number.isInteger(b.position) || b.position < 0 || b.position >= length) continue;
    const value = b.byte & 0xff;
    // History first, so the byte shown is always a member of the list (R7.7, R7.9).
    recordValue(h, b.position, value);
    g.byte[b.position] = value;
    g.conf[b.position] = clamp01(b.confidence);
    g.has[b.position] = 1;
  }
  const p = w.paper;
  const reading = detectKind(g.byte, g.conf, g.has);
  if (reading !== 'unknown') p.kind = reading;
  // Re-run on every snapshot: the hint may change or be withdrawn (R6.5). Only a tape gets one.
  p.hint = p.kind === 'tape' ? parseLayoutHint(g.byte, g.conf, g.has, p.payloadLength) : undefined;
  p.sheet = p.kind === 'ghost' ? 'single-line' : p.hint ? 'jcard' : 'generic';
  const f = clamp01(e.fractionReceived);
  set(w, { countdown: { remainingSec: (w.s.estimateSec ?? 0) * (1 - f), atMs: nowMs, running: true } });
}

function onPassComplete(w: Work, e: Extract<DecoderEvent, { type: 'pass-complete' }>, batch: BatchScan): void {
  if (w.s.phase !== 'receiving' || !w.paper || w.paper.tapeId !== e.tapeId) return;
  batch.passEndedFor = e.tapeId;
  set(w, {
    phase: 'between',
    passInProgress: false,
    clarityPct: Math.round(clamp01(e.clarity) * 100),
    clarityIsPrevious: false,
    parts: { recovered: e.blocksRecovered, total: e.blocksTotal },
  });
}

function onComplete(w: Work, e: Extract<DecoderEvent, { type: 'complete' }>, nowMs: number, batch: BatchScan): void {
  if (inFixedPhase(w)) return; // R8.6: a second complete changes nothing
  batch.completeFor.add(e.tapeId);

  const serialized = serializePayload(e.payload);
  if (!serialized.ok) {
    set(w, { unreadable: true });
    return;
  }
  const bytes = serialized.value;
  const isGhost = e.payload.kind === 'ghost';
  const hint = isGhost ? undefined : layoutFromPayload(e.payload);
  if (!isGhost && !hint) {
    set(w, { unreadable: true });
    return;
  }

  const sameTape = w.paper !== undefined && w.paper.tapeId === e.tapeId && w.paper.payloadLength === bytes.length;
  const history = sameTape ? cloneHistory(w.paper!.history) : createHistory(bytes.length);
  for (let i = 0; i < bytes.length; i++) recordValue(history, i, bytes[i]!);
  setPaper(
    w,
    {
      tapeId: e.tapeId,
      payloadLength: bytes.length,
      // Verified bytes at confidence 1: every glyph already shows its final character (R8.5).
      glyphs: { byte: bytes.slice(), conf: new Float32Array(bytes.length).fill(1), has: new Uint8Array(bytes.length).fill(1) },
      history,
      kind: e.payload.kind,
      hint,
      sheet: isGhost ? 'single-line' : 'jcard',
    },
    true,
  );
  set(w, {
    phase: 'fixing',
    fixStartMs: nowMs,
    payload: e.payload,
    passesUsed: e.passesUsed,
    checkpoint: undefined,
    passInProgress: false,
    countdown: undefined,
    unreadable: false,
    notice: undefined,
    pendingFaint: undefined,
  });
}

function onAlreadyReceived(w: Work, e: Extract<DecoderEvent, { type: 'already-received' }>): void {
  if (!inFixedPhase(w) || w.paper?.tapeId !== e.tapeId || w.s.notice === 'already-received') return;
  set(w, { notice: 'already-received' });
}

function onPassDiscarded(w: Work, e: Extract<DecoderEvent, { type: 'pass-discarded' }>, nowMs: number): void {
  if (inFixedPhase(w)) return;
  const notice = DISCARD_NOTICE[e.reason];
  if (notice === undefined) return;
  const patch: Partial<Mutable<DarkroomState>> = { notice, pendingFaint: undefined };
  if (w.s.safelight.signalPending) patch.safelight = { flickerUntilMs: undefined, signalPending: false }; // R9.9
  if (w.s.phase === 'receiving') {
    const cp = w.s.checkpoint;
    if (cp) {
      setPaper(w, cp.paper, false);
      patch.clarityPct = cp.clarityPct;
      patch.clarityIsPrevious = cp.clarityIsPrevious;
      patch.parts = cp.parts;
    }
    patch.phase = 'between';
    patch.passInProgress = false;
    // R10.9: pass number, clarity and parts stay as displayed; the countdown stops where it is.
    if (w.s.countdown) patch.countdown = { remainingSec: shownRemainingSec(w.s.countdown, nowMs), atMs: nowMs, running: false };
  }
  set(w, patch);
}

function processBatch(w: Work, events: readonly DecoderEvent[], nowMs: number): void {
  const batch: BatchScan = { passEndedFor: undefined, completeFor: new Set() };
  for (const e of events) {
    switch (e.type) {
      case 'signal-detected':
        onSignalDetected(w, nowMs);
        break;
      case 'header':
        onHeader(w, e, nowMs);
        break;
      case 'progress':
        onProgress(w, e, nowMs);
        break;
      case 'pass-complete':
        onPassComplete(w, e, batch);
        break;
      case 'complete':
        onComplete(w, e, nowMs, batch);
        break;
      case 'already-received':
        onAlreadyReceived(w, e);
        break;
      case 'pass-discarded':
        onPassDiscarded(w, e, nowMs);
        break;
    }
  }
  // R9.1: decide "still faint" only after the whole batch, and only if no complete came with it.
  if (batch.passEndedFor !== undefined && !batch.completeFor.has(batch.passEndedFor) && w.s.phase === 'between') {
    set(w, { pendingFaint: { tapeId: batch.passEndedFor, sinceMs: nowMs } });
  }
}

function processTick(w: Work, nowMs: number): void {
  const flickerUntilMs = w.s.safelight.flickerUntilMs;
  if (flickerUntilMs !== undefined && nowMs >= flickerUntilMs) {
    set(w, { safelight: { ...w.s.safelight, flickerUntilMs: undefined } });
  }
  if (w.s.phase === 'fixing' && w.s.fixStartMs !== undefined && nowMs >= w.s.fixStartMs + FIX_TOTAL_MS) {
    set(w, { phase: 'developed' });
  }
  const pending = w.s.pendingFaint;
  if (pending && nowMs - pending.sinceMs >= FAINT_GRACE_MS) {
    set(w, { notice: 'faint', pendingFaint: undefined });
  }
}

// ---- Public API ------------------------------------------------------------------------

export function reduceDarkroom(state: DarkroomState, input: DarkroomInput, nowMs: number): DarkroomState {
  switch (input.type) {
    case 'reset':
      return initialDarkroom();
    case 'tick': {
      const w = startWork(state);
      processTick(w, nowMs);
      return finish(w);
    }
    case 'batch':
      return reduceBatches(state, [input.events], nowMs);
  }
}

/**
 * Applies several batches in order with one state copy. This is what the controller calls once
 * per animation frame (R33.3): every event is applied, so the Symbol history misses nothing.
 * Each batch is judged on its own for the "still faint" rule.
 */
export function reduceBatches(state: DarkroomState, batches: readonly (readonly DecoderEvent[])[], nowMs: number): DarkroomState {
  const w = startWork(state);
  for (const events of batches) processBatch(w, events, nowMs);
  return finish(w);
}

/** Milliseconds from `nowMs` until a `tick` is next needed, or undefined when nothing is pending. */
export function nextWakeMs(state: DarkroomState, nowMs: number): number | undefined {
  const due: number[] = [];
  if (state.safelight.flickerUntilMs !== undefined) due.push(state.safelight.flickerUntilMs);
  if (state.phase === 'fixing' && state.fixStartMs !== undefined) due.push(state.fixStartMs + FIX_TOTAL_MS);
  if (state.pendingFaint) due.push(state.pendingFaint.sinceMs + FAINT_GRACE_MS);
  if (due.length === 0) return undefined;
  return Math.max(0, Math.min(...due) - nowMs);
}
