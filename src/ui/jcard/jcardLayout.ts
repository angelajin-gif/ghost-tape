// J-card slot rectangles (ghost-tape-ui design, "Sheet geometry"; R6.4, R18.12).
//
// One pure function shared by the Darkroom canvas and the Composer, so the print is the object
// the sender wrote. Everything is a function of the hint and the container width in CSS px:
// no DOM measurement, no clock, no randomness.

import { JCARD_CELL_MIN_PX, JCARD_COLS_MAX, JCARD_DATE_COLS, JCARD_SLOT_GAP_PX, JCARD_TITLE_SCALE, JCARD_TRACK_GUTTER_COLS, SHEET_CELL_ASPECT } from '../tokens';
import type { LayoutHint } from '../darkroom/layoutHint';

export type JCardSlotKind = 'title' | 'from' | 'to' | 'date' | 'track' | 'letter';

export interface JCardSlot {
  readonly kind: JCardSlotKind;
  /** Track number from 0; 0 for every other kind. */
  readonly index: number;
  /** Payload position of the slot's first byte, and how many bytes flow into it. */
  readonly start: number;
  readonly length: number;
  /** Cells per row inside the slot (a track's number gutter is not counted), rows, and the cell scale. */
  readonly cols: number;
  readonly rows: number;
  readonly scale: number;
  /** Columns at the left of the slot reserved for the track number; 0 for every other kind. */
  readonly gutterCols: number;
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface JCardLayout {
  readonly cols: number;
  /** Base cell size; a slot with scale s draws cells s times as large. */
  readonly cellWidthPx: number;
  readonly cellHeightPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly slots: readonly JCardSlot[];
}

/** Columns of the J-card and Single-line sheets at a container width. At least 4 so every slot has room. */
export function jcardCols(widthPx: number): number {
  const fit = Math.floor((Number.isFinite(widthPx) ? widthPx : 0) / JCARD_CELL_MIN_PX);
  return Math.max(JCARD_TRACK_GUTTER_COLS + 1, Math.min(JCARD_COLS_MAX, fit));
}

const rowsFor = (length: number, cols: number): number => Math.max(1, Math.ceil(length / cols));

export function jcardLayout(hint: LayoutHint, widthPx: number): JCardLayout {
  const cols = jcardCols(widthPx);
  const sheetWidthPx = Math.max(0, Number.isFinite(widthPx) ? widthPx : 0);
  const cellWidthPx = sheetWidthPx / cols;
  const cellHeightPx = SHEET_CELL_ASPECT * cellWidthPx;
  const o = hint.offsets;

  const slots: JCardSlot[] = [];
  let y = 0;
  const add = (kind: JCardSlotKind, index: number, start: number, length: number, slotCols: number, rows: number, scale: number, gutterCols: number): void => {
    const heightPx = rows * cellHeightPx * scale;
    // Full-width slots take the sheet width exactly so rounding never pushes one past the edge.
    const widthPx = slotCols + gutterCols === cols ? sheetWidthPx : (slotCols + gutterCols) * cellWidthPx * scale;
    slots.push({ kind, index, start, length, cols: slotCols, rows, scale, gutterCols, xPx: 0, yPx: y, widthPx, heightPx });
    y += heightPx + JCARD_SLOT_GAP_PX;
  };

  const titleCols = Math.max(1, Math.floor(cols / JCARD_TITLE_SCALE));
  add('title', 0, o.title, hint.titleLen, titleCols, rowsFor(hint.titleLen, titleCols), JCARD_TITLE_SCALE, 0);
  add('from', 0, o.from, hint.fromLen, cols, 1, 1, 0);
  add('to', 0, o.to, hint.toLen, cols, 1, 1, 0);
  // The date draws grain only (its three bytes are never drawn as characters, R6.1).
  add('date', 0, o.date, 3, Math.min(JCARD_DATE_COLS, cols), 1, 1, 0);
  const textCols = cols - JCARD_TRACK_GUTTER_COLS;
  hint.trackLens.forEach((len, i) => add('track', i, o.tracks[i]!, len, textCols, rowsFor(len, textCols), 1, JCARD_TRACK_GUTTER_COLS));
  // An empty letter still keeps one row, so the sheet shows where it would go.
  add('letter', 0, o.letter, hint.letterLen, cols, rowsFor(hint.letterLen, cols), 1, 0);

  return { cols, cellWidthPx, cellHeightPx, widthPx: sheetWidthPx, heightPx: Math.max(0, y - JCARD_SLOT_GAP_PX), slots };
}
