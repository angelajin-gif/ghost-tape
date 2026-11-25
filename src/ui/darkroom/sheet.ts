// Sheet geometry for the Darkroom Paper (ghost-tape-ui design, "Sheet geometry"; R4.3, R6.4, R13.1, R13.2).
//
// A pure function of lengths and the container width in CSS px, so the canvas needs no DOM
// measurement. Generic and Single-line sheets are grids of cells; the J-card sheet comes from
// `jcardLayout` and is a list of slot rectangles.

import { JCARD_TITLE_SCALE, SHEET_CELL_ASPECT, SHEET_CELL_MIN_PX } from '../tokens';
import { jcardCols, jcardLayout, type JCardLayout } from '../jcard/jcardLayout';
import type { LayoutHint } from './layoutHint';
import type { Paper } from './state';

/** A flowing block of equal cells (Generic and Single-line). */
export interface GridSheet {
  readonly layout: 'generic' | 'single-line';
  readonly cols: number;
  readonly rows: number;
  /** Number of cells. Generic: `P`. Single-line: `max(1, P - 2)`. */
  readonly cells: number;
  /** Payload position of the first cell: 0 for Generic, 2 for Single-line (position 1 is the length byte). */
  readonly firstPosition: number;
  readonly cellWidthPx: number;
  readonly cellHeightPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface JCardSheet extends JCardLayout {
  readonly layout: 'jcard';
}

export type Sheet = GridSheet | JCardSheet;

const finiteWidth = (widthPx: number): number => (Number.isFinite(widthPx) ? Math.max(0, widthPx) : 0);

/**
 * Generic sheet (R4.3): about twice as many columns as rows, capped by the narrowest cell.
 * `payloadLength < 1` gives one empty cell, so a blank Paper always has a size.
 */
export function genericSheet(payloadLength: number, widthPx: number): GridSheet {
  const w = finiteWidth(widthPx);
  const cells = Math.max(1, Math.floor(payloadLength) || 0);
  const cols = Math.max(1, Math.min(Math.ceil(Math.sqrt(2 * cells)), Math.floor(w / SHEET_CELL_MIN_PX)));
  const cellWidthPx = w / cols;
  const cellHeightPx = SHEET_CELL_ASPECT * cellWidthPx;
  const rows = Math.ceil(cells / cols);
  return { layout: 'generic', cols, rows, cells, firstPosition: 0, cellWidthPx, cellHeightPx, widthPx: w, heightPx: rows * cellHeightPx };
}

/**
 * Single-line sheet (R13.1, R13.2): `P - 2` message cells at 1.5 times the base size, wrapped as
 * a paragraph. `P < 2` gives one empty cell.
 */
export function singleLineSheet(payloadLength: number, widthPx: number): GridSheet {
  const w = finiteWidth(widthPx);
  const baseCols = jcardCols(w);
  const cells = Math.max(1, Math.floor(payloadLength) - 2 || 0);
  const cols = Math.max(1, Math.floor(baseCols / JCARD_TITLE_SCALE));
  const cellWidthPx = (w / baseCols) * JCARD_TITLE_SCALE;
  const cellHeightPx = SHEET_CELL_ASPECT * cellWidthPx;
  const rows = Math.ceil(cells / cols);
  return { layout: 'single-line', cols, rows, cells, firstPosition: 2, cellWidthPx, cellHeightPx, widthPx: w, heightPx: rows * cellHeightPx };
}

export function jcardSheet(hint: LayoutHint, widthPx: number): JCardSheet {
  return { layout: 'jcard', ...jcardLayout(hint, finiteWidth(widthPx)) };
}

/** The geometry the Paper's current layout asks for. A J-card layout without a hint falls back to Generic. */
export function sheetFor(paper: Pick<Paper, 'sheet' | 'hint' | 'payloadLength'>, widthPx: number): Sheet {
  if (paper.sheet === 'single-line') return singleLineSheet(paper.payloadLength, widthPx);
  if (paper.sheet === 'jcard' && paper.hint) return jcardSheet(paper.hint, widthPx);
  return genericSheet(paper.payloadLength, widthPx);
}
