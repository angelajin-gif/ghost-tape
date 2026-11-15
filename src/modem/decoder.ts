// The streaming decoder: audio in, events out (design.md "Decoder").
//
//   SEARCH -- chirp found --> SYNC -- sync notes found --> HEADER -- header valid --> PAYLOAD
//     ^                         |  (no sync: back, no event)   |  (invalid: pass-discarded)    |
//     +-------------------------+------------------------------+-------- pass end ------------+
//
// Task 9 covers one pass at a time: find it, read the header, hard-decide every payload
// symbol, run the verification chain. Combining passes (task 12), progress events and the
// remaining event rules (task 13) and timing tracking (task 11) build on this skeleton.
//
// Chunking invariance (R4.3): every step runs only when the audio it needs is already
// buffered, and what it decides depends only on that audio. So the events are the same
// however the stream was cut into push() calls. flush() marks the end of the stream: steps
// that were waiting for more audio then work with what exists.

import { SampleBuffer } from './buffer';
import { analysisSamples, decide, readSymbol, windowStart } from './demodulate';
import { assemblePayload, decodePayloadBlocks, frameLayout, HEADER_BYTES, POSTAMBLE_MS, sampleAtMs, tonesToHeader, type Header } from './frame';
import { geometry, payloadSymbolCount } from './interleave';
import { HEADER_PROFILE_NAME, PROFILES, profileById, profileByName, validateProfileTable, type Profile, type ProfileTable } from './profiles';
import { ChirpDetector, fineTiming, fineTimingSpan, FINE_TIMING_MAX_SHIFT_MS } from './sync';
import { deserializePayload } from './tape';
import type { DecodeFileResult, Decoder, DecoderEvent, DiscardReason } from './types';

/** Sample rates the decoder accepts (R3.3). */
export const MIN_DECODE_SAMPLE_RATE = 16000;
export const MAX_DECODE_SAMPLE_RATE = 48000;

/** What the decoder decided for each payload symbol of a pass, before error correction. */
export interface PassSymbols {
  readonly tapeId: number;
  readonly profile: string;
  /** Hard-decided tone index of every payload symbol, pilots included. */
  readonly tones: Uint8Array;
  /** Confidence 1 − second/best of every decision, 0..1. */
  readonly confidence: Float64Array;
}

export interface DecoderOptions {
  readonly sampleRate: number;
  /** Profile table to use instead of the built-in one (R9.7). */
  readonly profiles?: ProfileTable;
  /**
   * Diagnostics: called once per pass with the raw symbol decisions, so symbol error rate can be
   * measured against what was sent. Read-only; it changes nothing about decoding.
   */
  readonly onPassSymbols?: (pass: PassSymbols) => void;
}

export const isSupportedSampleRate = (rate: number): boolean =>
  typeof rate === 'number' && Number.isFinite(rate) && rate >= MIN_DECODE_SAMPLE_RATE && rate <= MAX_DECODE_SAMPLE_RATE;

type Phase = 'search' | 'sync' | 'header' | 'payload';

interface PassState {
  readonly header: Header;
  readonly profile: Profile;
  readonly passNumber: number;
  readonly symbols: number;
  readonly payloadStartMs: number;
  readonly totalMs: number;
  readonly tones: Uint8Array;
  readonly confidence: Float64Array;
  next: number;
}

class StreamDecoder implements Decoder {
  private readonly buffer = new SampleBuffer();
  private readonly detector: ChirpDetector;
  private readonly robust: Profile;
  private readonly syncStartMs: number;
  private readonly headerStartMs: number;
  private readonly headerSymbols: number;
  private events: DecoderEvent[] = [];
  private phase: Phase = 'search';
  private chirpStart = 0;
  private shift = 0;
  private pass: PassState | undefined;
  /** How many passes of each tapeId have been read, for the `pass` number in header events. */
  private readonly passCounts = new Map<number, number>();

  constructor(
    private readonly sampleRate: number,
    private readonly table: ProfileTable,
    private readonly onPassSymbols?: (pass: PassSymbols) => void,
  ) {
    this.detector = new ChirpDetector(sampleRate);
    this.robust = profileByName(table, HEADER_PROFILE_NAME)!;
    const layout = frameLayout(0, this.robust, this.robust);
    this.syncStartMs = layout.syncStartMs;
    this.headerStartMs = layout.headerStartMs;
    this.headerSymbols = (HEADER_BYTES * 8) / this.robust.bitsPerSymbol;
    this.detector.resume(0);
  }

  push(samples: Float32Array): DecoderEvent[] {
    this.guarded(() => {
      if (!(samples instanceof Float32Array) || samples.length === 0) return;
      this.buffer.append(samples);
      this.advance(false);
    });
    return this.drain();
  }

  flush(): DecoderEvent[] {
    this.guarded(() => {
      this.advance(true);
      // The stream is over: whatever follows starts a fresh search.
      this.pass = undefined;
      this.phase = 'search';
      this.buffer.clear(this.buffer.end);
      this.detector.resume(this.buffer.end);
    });
    return this.drain();
  }

  reset(): void {
    this.events = [];
    this.passCounts.clear();
    this.pass = undefined;
    this.phase = 'search';
    this.buffer.clear(this.buffer.end);
    this.detector.resume(this.buffer.end);
  }

  private drain(): DecoderEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** push() and flush() must never throw (R11.6): an internal error abandons the pass and searches on. */
  private guarded(work: () => void): void {
    try {
      work();
    } catch {
      this.pass = undefined;
      this.phase = 'search';
      this.buffer.clear(this.buffer.end);
      this.detector.resume(this.buffer.end);
    }
  }

  private at(ms: number): number {
    return sampleAtMs(ms, this.sampleRate);
  }

  private advance(final: boolean): void {
    for (;;) {
      let progressed: boolean;
      switch (this.phase) {
        case 'search':
          progressed = this.stepSearch(final);
          break;
        case 'sync':
          progressed = this.stepSync(final);
          break;
        case 'header':
          progressed = this.stepHeader(final);
          break;
        case 'payload':
          progressed = this.stepPayload(final);
          break;
      }
      if (!progressed) break;
    }
    this.buffer.trimBefore(this.keepFrom());
  }

  /** Oldest sample any later step can still need. */
  private keepFrom(): number {
    const slack = this.at(FINE_TIMING_MAX_SHIFT_MS);
    switch (this.phase) {
      case 'search':
        return this.detector.keepFrom();
      case 'sync':
      case 'header':
        return this.chirpStart - slack;
      case 'payload': {
        const p = this.pass!;
        return windowStart(this.chirpStart, this.shift, p.payloadStartMs, p.next, p.profile, this.sampleRate) - slack;
      }
    }
  }

  private stepSearch(final: boolean): boolean {
    const hit = this.detector.scan(this.buffer, final);
    if (hit === undefined) return false;
    this.chirpStart = hit;
    this.phase = 'sync';
    return true;
  }

  private stepSync(final: boolean): boolean {
    if (this.buffer.end < this.chirpStart + fineTimingSpan(this.syncStartMs, this.robust, this.sampleRate)) {
      if (final) this.backToSearch(this.chirpStart + this.detector.templateLength);
      return false;
    }
    const timing = fineTiming(this.buffer, this.chirpStart, this.syncStartMs, this.robust, this.sampleRate);
    if (!timing) {
      // A chirp-like sound with no sync notes behind it: not ours. Say nothing and carry on.
      this.backToSearch(this.chirpStart + this.detector.templateLength);
      return true;
    }
    this.shift = timing.shift;
    this.events.push({ type: 'signal-detected', atSample: this.chirpStart });
    this.phase = 'header';
    return true;
  }

  private stepHeader(final: boolean): boolean {
    const robust = this.robust;
    const length = analysisSamples(robust, this.sampleRate);
    const lastStart = windowStart(this.chirpStart, this.shift, this.headerStartMs, this.headerSymbols - 1, robust, this.sampleRate);
    if (this.buffer.end < lastStart + length) {
      if (final) this.discard('signal-lost', this.buffer.end);
      return false;
    }
    const tones = new Uint8Array(this.headerSymbols);
    for (let k = 0; k < this.headerSymbols; k++) {
      const start = windowStart(this.chirpStart, this.shift, this.headerStartMs, k, robust, this.sampleRate);
      const segment = this.buffer.view(start, length);
      tones[k] = segment ? decide(readSymbol(segment, robust, this.sampleRate)).tone : 0;
    }
    const header = tonesToHeader(tones, this.table);
    const payloadStartMs = this.headerStartMs + this.headerSymbols * robust.symbolMs;
    if (!header.ok) {
      this.discard('header-invalid', this.chirpStart + this.at(payloadStartMs));
      return true;
    }
    const profile = profileById(this.table, header.value.profileId)!;
    const symbols = payloadSymbolCount(geometry(header.value.payloadLength), profile);
    const passNumber = (this.passCounts.get(header.value.tapeId) ?? 0) + 1;
    this.passCounts.set(header.value.tapeId, passNumber);
    this.pass = {
      header: header.value,
      profile,
      passNumber,
      symbols,
      payloadStartMs,
      totalMs: frameLayout(symbols, profile, robust).totalMs,
      tones: new Uint8Array(symbols),
      confidence: new Float64Array(symbols),
      next: 0,
    };
    this.events.push({
      type: 'header',
      tapeId: header.value.tapeId,
      profile: profile.name,
      payloadLength: header.value.payloadLength,
      pass: passNumber,
      estimatedSecondsRemaining: (symbols * profile.symbolMs + POSTAMBLE_MS) / 1000,
    });
    this.phase = 'payload';
    return true;
  }

  private stepPayload(final: boolean): boolean {
    const p = this.pass!;
    const length = analysisSamples(p.profile, this.sampleRate);
    let progressed = false;
    while (p.next < p.symbols) {
      const start = windowStart(this.chirpStart, this.shift, p.payloadStartMs, p.next, p.profile, this.sampleRate);
      const segment = this.buffer.view(start, length);
      if (!segment) break;
      const d = decide(readSymbol(segment, p.profile, this.sampleRate));
      p.tones[p.next] = d.tone;
      p.confidence[p.next] = d.confidence;
      p.next++;
      progressed = true;
    }
    if (p.next === p.symbols) {
      this.finishPass(p);
      return true;
    }
    if (final) this.discard('signal-lost', this.buffer.end);
    return progressed;
  }

  /** The verification chain (R7.2): every RS block, CRC trailer, tapeId, strict parse. */
  private finishPass(p: PassState): void {
    const { header, profile } = p;
    this.onPassSymbols?.({ tapeId: header.tapeId, profile: profile.name, tones: p.tones.slice(), confidence: p.confidence.slice() });
    const blocks = decodePayloadBlocks(p.tones, header.payloadLength, profile);
    const blocksTotal = geometry(header.payloadLength).blocks;
    const blocksRecovered = blocks.ok ? blocks.value.blocks.filter((b) => b !== undefined).length : 0;
    let clarity = 0;
    for (const c of p.confidence) clarity += c;
    clarity /= Math.max(1, p.symbols);
    this.events.push({ type: 'pass-complete', tapeId: header.tapeId, pass: p.passNumber, blocksRecovered, blocksTotal, clarity });

    if (blocks.ok && blocksRecovered === blocksTotal) {
      const assembled = assemblePayload(blocks.value);
      if (assembled.ok && assembled.value.crc === header.tapeId) {
        const payload = deserializePayload(assembled.value.payload);
        if (payload.ok) this.events.push({ type: 'complete', tapeId: header.tapeId, payload: payload.value, passesUsed: 1 });
      }
    }
    // Resume after the postamble so the down-chirp is never mistaken for a new pass.
    this.pass = undefined;
    this.backToSearch(this.chirpStart + this.at(p.totalMs));
  }

  private discard(reason: DiscardReason, resumeAt: number): void {
    this.events.push({ type: 'pass-discarded', reason });
    this.pass = undefined;
    this.backToSearch(resumeAt);
  }

  private backToSearch(resumeAt: number): void {
    this.phase = 'search';
    this.detector.resume(resumeAt);
  }
}

/** A decoder that ignores all input, returned for an unusable configuration instead of throwing. */
const INERT_DECODER: Decoder = {
  push: () => [],
  flush: () => [],
  reset: () => undefined,
};

/**
 * Create a streaming decoder. A sample rate outside 16000–48000 Hz or an invalid profile
 * table gives a decoder that never reports anything; decodeFile reports the reason.
 */
export function createDecoder(options: DecoderOptions): Decoder {
  const table = options.profiles ?? PROFILES;
  if (!isSupportedSampleRate(options.sampleRate) || !validateProfileTable(table).ok) return INERT_DECODER;
  return new StreamDecoder(options.sampleRate, table, options.onPassSymbols);
}

/**
 * Decode a whole recording. Returns the first verified payload, or a reason: "no signal
 * found" when no ghost track header was seen, otherwise that the tape is not yet developed,
 * with the clarity of the last pass. Never throws (R3.6).
 */
export function decodeFile(samples: Float32Array, sampleRate: number, profiles?: ProfileTable): DecodeFileResult {
  if (!isSupportedSampleRate(sampleRate)) {
    return { ok: false, reason: `sample rate ${String(sampleRate)} Hz is outside ${MIN_DECODE_SAMPLE_RATE}-${MAX_DECODE_SAMPLE_RATE} Hz`, clarity: 0 };
  }
  if (!(samples instanceof Float32Array)) return { ok: false, reason: 'input must be a Float32Array of samples', clarity: 0 };
  const decoder = createDecoder({ sampleRate, ...(profiles ? { profiles } : {}) });
  const events = [...decoder.push(samples), ...decoder.flush()];
  const complete = events.find((e): e is Extract<DecoderEvent, { type: 'complete' }> => e.type === 'complete');
  if (complete) return { ok: true, payload: complete.payload, passesUsed: complete.passesUsed };
  let clarity = 0;
  for (const e of events) if (e.type === 'pass-complete') clarity = e.clarity;
  const sawHeader = events.some((e) => e.type === 'header');
  return { ok: false, reason: sawHeader ? 'a ghost track was found but the tape is not yet developed' : 'no signal found', clarity };
}
