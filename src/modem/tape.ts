// Tape and ghost format: validate, serialize, deserialize (design.md "Tape format", R2).
//
// One rule set serves both directions: the encoder rejects anything the decoder
// would reject, and the decoder accepts only bytes the encoder could have written.
// That makes serialize/deserialize exact inverses and keeps the decoder from ever
// showing a field that is out of spec (R7.4).

import type { Ghost, Payload, Result, Tape } from './types';

// ---------- charset ----------

/** The seven marks outside ASCII, in byte order 0x80..0x86 (Glossary). */
export const CHARSET_MARKS = ['\u2018', '\u2019', '\u201C', '\u201D', '\u2014', '\u2026', '\u2013'] as const; // ‘ ’ “ ” — … –
const MARK_BASE = 0x80;
const NEWLINE = 0x0a;

const markToByte = new Map<string, number>(CHARSET_MARKS.map((m, i) => [m, MARK_BASE + i]));

/** Every character a text field may contain, except newline. */
export const CHARSET_CHARACTERS: readonly string[] = [
  ...Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)),
  ...CHARSET_MARKS,
];

// ---------- limits ----------

export const LIMITS = {
  title: 40,
  from: 24,
  to: 24,
  trackCount: 10,
  track: 60,
  letter: 800,
  ghostMessageMin: 1,
  ghostMessageMax: 140,
} as const;

const KIND_TAPE = 0;
const KIND_GHOST = 1;
const MIN_YEAR = 2000;
const MAX_YEAR = 2255;

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const describeChar = (ch: string): string => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** Text -> charset bytes. One character is one byte (R2.3). Fails naming the field. */
export function encodeText(field: string, text: string, maxLength: number, allowNewline: boolean): Result<Uint8Array> {
  if (typeof text !== 'string') return fail(`${field}: must be text`);
  const bytes: number[] = [];
  // for..of walks code points, so an emoji is one (rejected) character, not two halves.
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) bytes.push(code);
    else if (markToByte.has(ch)) bytes.push(markToByte.get(ch)!);
    else if (code === NEWLINE) {
      if (!allowNewline) return fail(`${field}: newline is only allowed in the letter`);
      bytes.push(NEWLINE);
    } else return fail(`${field}: character ${describeChar(ch)} is not in the Ghost Tape charset`);
  }
  if (bytes.length > maxLength) return fail(`${field}: ${bytes.length} characters, maximum ${maxLength}`);
  return { ok: true, value: Uint8Array.from(bytes) };
}

/** Charset bytes -> text. Strict: any byte outside the charset fails (R2.9). */
export function decodeText(field: string, bytes: Uint8Array, allowNewline: boolean): Result<string> {
  let text = '';
  for (const b of bytes) {
    if (b >= 0x20 && b <= 0x7e) text += String.fromCharCode(b);
    else if (b >= MARK_BASE && b < MARK_BASE + CHARSET_MARKS.length) text += CHARSET_MARKS[b - MARK_BASE];
    else if (b === NEWLINE && allowNewline) text += '\n';
    else return fail(`${field}: byte 0x${b.toString(16).padStart(2, '0')} is not allowed`);
  }
  return { ok: true, value: text };
}

// ---------- date ----------

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, m: number): number => [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;

const validYmd = (y: number, m: number, d: number): boolean =>
  y >= MIN_YEAR && y <= MAX_YEAR && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

/** `YYYY-MM-DD` -> 3 bytes (year − 2000, month, day); absent -> 00 00 00 (R2.7). */
export function encodeDate(date: string | undefined): Result<Uint8Array> {
  if (date === undefined) return { ok: true, value: new Uint8Array(3) };
  if (typeof date !== 'string') return fail('date: must be text in the form YYYY-MM-DD');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return fail(`date: "${date}" is not in the form YYYY-MM-DD`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > MAX_YEAR) return fail(`date: ${date} is outside 2000-01-01 to 2255-12-31`);
  if (!validYmd(y, mo, d)) return fail(`date: ${date} is not a real calendar date`);
  return { ok: true, value: Uint8Array.of(y - MIN_YEAR, mo, d) };
}

/** Inverse of encodeDate. 00 00 00 is absent; any other non-date fails. */
export function decodeDate(bytes: Uint8Array): Result<string | undefined> {
  const [yb, mo, d] = [bytes[0]!, bytes[1]!, bytes[2]!];
  if (yb === 0 && mo === 0 && d === 0) return { ok: true, value: undefined };
  const y = yb + MIN_YEAR;
  if (!validYmd(y, mo, d)) return fail('date: bytes do not form a valid date');
  return { ok: true, value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

// ---------- serialize ----------

class Writer {
  private readonly parts: number[] = [];
  u8(v: number): void {
    this.parts.push(v & 0xff);
  }
  u16(v: number): void {
    this.parts.push((v >> 8) & 0xff, v & 0xff);
  }
  bytes(b: Uint8Array): void {
    for (const x of b) this.parts.push(x);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

/** Validate and serialize a tape or ghost. Never throws; reasons name the field (R2.4). */
export function serializePayload(payload: Payload): Result<Uint8Array> {
  if (payload === null || typeof payload !== 'object') return fail('payload: must be a tape or a ghost');
  if (payload.kind === 'ghost') return serializeGhost(payload);
  if (payload.kind === 'tape') return serializeTape(payload);
  return fail('kind: must be "tape" or "ghost"');
}

function serializeGhost(ghost: Ghost): Result<Uint8Array> {
  const message = encodeText('message', ghost.message, LIMITS.ghostMessageMax, false);
  if (!message.ok) return message;
  if (message.value.length < LIMITS.ghostMessageMin) return fail('message: must not be empty');
  const w = new Writer();
  w.u8(KIND_GHOST);
  w.u8(message.value.length);
  w.bytes(message.value);
  return { ok: true, value: w.done() };
}

function serializeTape(tape: Tape): Result<Uint8Array> {
  const title = encodeText('title', tape.title, LIMITS.title, false);
  if (!title.ok) return title;
  const from = encodeText('from', tape.from, LIMITS.from, false);
  if (!from.ok) return from;
  const to = encodeText('to', tape.to, LIMITS.to, false);
  if (!to.ok) return to;
  if (title.value.length + from.value.length + to.value.length === 0) {
    return fail('title, from and to: at least one must be filled in');
  }
  const date = encodeDate(tape.date);
  if (!date.ok) return date;
  if (!Array.isArray(tape.tracks)) return fail('tracks: must be a list');
  if (tape.tracks.length > LIMITS.trackCount) return fail(`tracks: ${tape.tracks.length} tracks, maximum ${LIMITS.trackCount}`);
  const tracks: Uint8Array[] = [];
  for (let i = 0; i < tape.tracks.length; i++) {
    const t = encodeText(`tracks[${i}]`, tape.tracks[i]!, LIMITS.track, false);
    if (!t.ok) return t;
    tracks.push(t.value);
  }
  const letter = encodeText('letter', tape.letter, LIMITS.letter, true);
  if (!letter.ok) return letter;
  // Doodles are on the cut list (R2.2); until that task ships the flag is always 0.
  if (tape.doodle !== undefined) return fail('doodle: doodles are not supported yet');

  const w = new Writer();
  w.u8(KIND_TAPE);
  for (const field of [title.value, from.value, to.value]) {
    w.u8(field.length);
    w.bytes(field);
  }
  w.bytes(date.value);
  w.u8(tracks.length);
  for (const t of tracks) {
    w.u8(t.length);
    w.bytes(t);
  }
  w.u16(letter.value.length);
  w.bytes(letter.value);
  w.u8(0); // doodleFlag
  return { ok: true, value: w.done() };
}

/**
 * Serialize and enforce the chosen profile's size cap (R1.2, R1.3). The cap
 * itself comes from the profile table.
 */
export function serializeWithinCap(payload: Payload, capBytes: number, profileName: string): Result<Uint8Array> {
  const bytes = serializePayload(payload);
  if (!bytes.ok) return bytes;
  if (bytes.value.length > capBytes) {
    return fail(`encoded size ${bytes.value.length} bytes exceeds the ${capBytes}-byte cap of the ${profileName} profile`);
  }
  return bytes;
}

// ---------- deserialize ----------

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get remaining(): number {
    return this.bytes.length - this.offset;
  }
  u8(): number | undefined {
    return this.offset < this.bytes.length ? this.bytes[this.offset++]! : undefined;
  }
  u16(): number | undefined {
    const hi = this.u8();
    const lo = this.u8();
    return hi === undefined || lo === undefined ? undefined : (hi << 8) | lo;
  }
  take(n: number): Uint8Array | undefined {
    if (n > this.remaining) return undefined;
    const out = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
}

function readText(r: Reader, field: string, length: number | undefined, max: number, allowNewline: boolean): Result<string> {
  if (length === undefined) return fail(`${field}: truncated`);
  if (length > max) return fail(`${field}: length ${length} exceeds ${max}`);
  const bytes = r.take(length);
  if (bytes === undefined) return fail(`${field}: truncated`);
  return decodeText(field, bytes, allowNewline);
}

/** Strict inverse of serializePayload (R2.9, R7.4). Never throws. */
export function deserializePayload(bytes: Uint8Array): Result<Payload> {
  const r = new Reader(bytes);
  const kind = r.u8();
  let result: Result<Payload>;
  if (kind === KIND_GHOST) result = readGhost(r);
  else if (kind === KIND_TAPE) result = readTape(r);
  else return fail('kind: unknown payload kind');
  if (result.ok && r.remaining !== 0) return fail(`payload: ${r.remaining} unexpected trailing bytes`);
  return result;
}

function readGhost(r: Reader): Result<Ghost> {
  const message = readText(r, 'message', r.u8(), LIMITS.ghostMessageMax, false);
  if (!message.ok) return message;
  if (message.value.length < LIMITS.ghostMessageMin) return fail('message: must not be empty');
  return { ok: true, value: { kind: 'ghost', message: message.value } };
}

function readTape(r: Reader): Result<Tape> {
  const title = readText(r, 'title', r.u8(), LIMITS.title, false);
  if (!title.ok) return title;
  const from = readText(r, 'from', r.u8(), LIMITS.from, false);
  if (!from.ok) return from;
  const to = readText(r, 'to', r.u8(), LIMITS.to, false);
  if (!to.ok) return to;
  if (title.value.length + from.value.length + to.value.length === 0) return fail('title, from and to: all empty');
  const dateBytes = r.take(3);
  if (dateBytes === undefined) return fail('date: truncated');
  const date = decodeDate(dateBytes);
  if (!date.ok) return date;
  const trackCount = r.u8();
  if (trackCount === undefined) return fail('tracks: truncated');
  if (trackCount > LIMITS.trackCount) return fail(`tracks: ${trackCount} tracks, maximum ${LIMITS.trackCount}`);
  const tracks: string[] = [];
  for (let i = 0; i < trackCount; i++) {
    const t = readText(r, `tracks[${i}]`, r.u8(), LIMITS.track, false);
    if (!t.ok) return t;
    tracks.push(t.value);
  }
  const letter = readText(r, 'letter', r.u16(), LIMITS.letter, true);
  if (!letter.ok) return letter;
  const doodleFlag = r.u8();
  if (doodleFlag !== 0) return fail(doodleFlag === undefined ? 'doodle: truncated' : 'doodle: flag must be 0');
  const tape: Tape = {
    kind: 'tape',
    title: title.value,
    from: from.value,
    to: to.value,
    ...(date.value !== undefined ? { date: date.value } : {}),
    tracks,
    letter: letter.value,
  };
  return { ok: true, value: tape };
}
