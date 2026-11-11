import { describe, expect, it } from 'vitest';
import { CHARSET_CHARACTERS, CHARSET_MARKS, deserializePayload, encodeText, serializePayload } from '../../src/modem/tape';

describe('tape format known answers', () => {
  it('serializes a small tape with the documented layout', () => {
    const r = serializePayload({ kind: 'tape', title: 'Hi', from: 'A', to: '', date: '2026-10-31', tracks: ['x'], letter: '“ok”\n' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.value]).toEqual([
      0x00, // kind = tape
      2, 0x48, 0x69, // title "Hi"
      1, 0x41, // from "A"
      0, // to ""
      26, 10, 31, // date 2026-10-31
      1, 1, 0x78, // 1 track: "x"
      0x00, 0x05, 0x82, 0x6f, 0x6b, 0x83, 0x0a, // letter “ok”\n (u16 length)
      0x00, // no doodle
    ]);
  });

  it('serializes a ghost as kind, length, bytes', () => {
    expect(serializePayload({ kind: 'ghost', message: 'Boo…' })).toEqual({ ok: true, value: Uint8Array.of(1, 4, 0x42, 0x6f, 0x6f, 0x85) });
  });

  it('maps the seven marks to 0x80..0x86 in glossary order, en dash last', () => {
    expect(CHARSET_MARKS).toEqual(['‘', '’', '“', '”', '—', '…', '–']);
    const r = encodeText('t', CHARSET_MARKS.join(''), 10, false);
    expect(r).toEqual({ ok: true, value: Uint8Array.of(0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86) });
    expect(CHARSET_CHARACTERS.length).toBe(95 + 7);
  });

  it('decodes an absent date (00 00 00) as no date key', () => {
    // kind, title "A", from "", to "", date 00 00 00, 0 tracks, letter length 00 00, doodle 0
    const r = deserializePayload(Uint8Array.of(0, 1, 0x41, 0, 0, 0, 0, 0, 0, 0, 0, 0));
    expect(r).toStrictEqual({ ok: true, value: { kind: 'tape', title: 'A', from: '', to: '', tracks: [], letter: '' } });
  });

  it('rejects a date with month 0 but non-zero other bytes (absent and present cannot be confused)', () => {
    expect(deserializePayload(Uint8Array.of(0, 1, 0x41, 0, 0, 26, 0, 1, 0, 0, 0, 0)).ok).toBe(false);
  });
});
