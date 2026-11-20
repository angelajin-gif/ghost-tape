// R7.8: a provisional entry must not be assignable to Payload. This file is checked by `tsc`
// (npm test runs the typecheck first): each `@ts-expect-error` line must really be a type error,
// or the compiler reports the directive as unused and the typecheck fails.
import { describe, expect, it } from 'vitest';
import type { DecoderEvent, Payload, ProvisionalByte, Tape } from '../../src/modem/types';

const provisional: ProvisionalByte = { kind: 'provisional', position: 0, byte: 0x41, confidence: 0.5 };
const progress: Extract<DecoderEvent, { type: 'progress' }> = { type: 'progress', tapeId: 1, provisional: [provisional], fractionReceived: 0.1 };

// @ts-expect-error a provisional byte is not a Payload (R7.8)
const asPayload: Payload = provisional;
// @ts-expect-error nor is a list of them a list of payloads
const asPayloads: Payload[] = progress.provisional;
// @ts-expect-error a complete event cannot be built from provisional bytes
const asComplete: Extract<DecoderEvent, { type: 'complete' }> = { type: 'complete', tapeId: 1, payload: provisional, passesUsed: 1 };

// Control: a real tape is a Payload, so the errors above come from the provisional type, not from a broken Payload.
const tape: Tape = { kind: 'tape', title: 'T', from: '', to: '', tracks: [], letter: '' };
const asTape: Payload = tape;

describe('R7.8 type-level test', () => {
  it('is enforced by tsc; at run time the values are just what they were assigned', () => {
    expect([asPayload, asPayloads, asComplete, asTape].length).toBe(4);
  });
});
