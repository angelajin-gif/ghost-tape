// The streaming decoder: audio in, events out (design.md "Decoder").
//
//   SEARCH -- chirp found --> SYNC -- sync notes found --> HEADER -- header valid --> PAYLOAD
//     ^                         |  (no sync: back, no event)   |  (invalid: pass-discarded)    |
//     +-------------------------+------------------------------+-------- pass end ------------+
//
// Per pass: find it, read the header, read every payload symbol (with timing tracking),
// send `progress` with provisional bytes every 200 ms of audio, stop early if the signal is
// lost, then combine with earlier passes and run the verification chain.
//
// Chunking invariance (R4.3): every step runs only when the audio it needs is already
// buffered, and what it decides depends only on that audio. So the events are the same
// however the stream was cut into push() calls. flush() marks the end of the stream: steps
// that were waiting for more audio then work with what exists.

import { SampleBuffer } from './buffer';
import { AccumulatorStore, decideFromSums, isAligned } from './accumulator';
import { analysisSamples, calibrateGate, ClockTracker, decide, goertzelEnergies, goertzelEnergy, normalizeEnergies, windowStart, type Gate } from './demodulate';
import { assemblePayload, decodePayloadBlocks, frameLayout, HEADER_BYTES, POSTAMBLE_MS, provisionalBytes, sampleAtMs, tonesToHeader, type Header } from './frame';
import { geometry, payloadSymbolCount } from './interleave';
import { HEADER_PROFILE_NAME, PROFILES, profileById, profileByName, validateProfileTable, type Profile, type ProfileTable } from './profiles';
import { ChirpDetector, fineTiming, fineTimingSpan, FINE_TIMING_MAX_SHIFT_MS } from './sync';
import { deserializePayload } from './tape';
import type { DecodeFileResult, Decoder, DecoderEvent, DiscardReason, ProvisionalByte } from './types';

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

/** What the decoder read for one header (diagnostics, task 14). */
export interface HeaderSymbols {
  /** Stream sample where the chirp was found, and the fine-timing shift applied on top (samples). */
  readonly chirpStart: number;
  readonly shift: number;
  /** Hard-decided tone of each of the 80 header symbols, and its confidence. */
  readonly tones: Uint8Array;
  readonly confidence: Float64Array;
  readonly valid: boolean;
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
  /** Diagnostics: called once per header read, valid or not, with where it was read and what was decided. Read-only. */
  readonly onHeaderSymbols?: (header: HeaderSymbols) => void;
  /** How long a tape's evidence is kept after its last activity, in audio time. Default 600 s (R6.8). */
  readonly retentionSeconds?: number;
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
  readonly gate: Gate;
  /** True when this tape was already complete and retained at the header: the pass is a repeat (R8.17). */
  readonly repeat: boolean;
  /** This pass's normalised energies, symbols × tones. They join the tape's accumulator only if the pass turns out aligned (R6.5, R6.6). */
  readonly pending: Float64Array;
  /** This pass's own hard decisions (not the combined ones): they drive the timing gate and the diagnostics hook. */
  readonly tones: Uint8Array;
  readonly confidence: Float64Array;
  /** Where each decided symbol's window started, and its nominal time, kept for the early/late gate. */
  readonly starts: Float64Array;
  readonly nominals: Float64Array;
  /** Mean tone level of the header (see toneLevel): the reference for signal-lost. */
  readonly headerLevel: number;
  /** Tone level of each payload symbol read so far. */
  readonly levels: Float64Array;
  /** Payload time (ms from the first payload symbol) of the last `progress`, or of the header (0). */
  lastProgressMs: number;
  next: number;
}

/** Progress cadence in audio time (R8.3 asks for ≤ 250 ms; design "Progress and provisional bytes"). */
export const PROGRESS_INTERVAL_MS = 200;
/** Signal-lost window: wider than the longest dropout the decoder must ride through (150 ms, R5.6). */
export const SIGNAL_LOST_WINDOW_MS = 400;
/** Signal lost = the window's tone level is this far below the header's: 30 dB. */
export const SIGNAL_LOST_RATIO = 1e-3;

/**
 * Energy at the ghost's own tones in one window, per sample squared. A tone of amplitude A gives a
 * Goertzel energy of about (A·N/2)² over N samples, so dividing by N² makes the level about A²/4
 * whatever the window length: header (Robust) and payload windows can then be compared. Only the
 * tone frequencies count, which keeps the measure inside the band the ghost uses: hum or hiss
 * between the tones barely moves it.
 */
function toneLevel(energies: Float64Array, length: number): number {
  let sum = 0;
  for (const e of energies) sum += e;
  return length > 0 ? sum / (length * length) : 0;
}

/** Audio kept or awaited around a window: covers the early probe (up to 18 ms), the late probe, and drift between readings. */
const TRACKING_SLACK_MS = 40;
/** A reading is used only when the symbol was decided clearly (confidence 1 − second/best). */
const MIN_TRACKING_CONFIDENCE = 0.5;

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
  /** Tracks the receiver clock's error across the header and payload of the current pass. */
  private clock = new ClockTracker(0);
  /** The evidence gathered so far for up to four tapes (R6). */
  private readonly store: AccumulatorStore;

  constructor(
    private readonly sampleRate: number,
    private readonly table: ProfileTable,
    private readonly onPassSymbols?: (pass: PassSymbols) => void,
    retentionSeconds?: number,
    private readonly onHeaderSymbols?: (header: HeaderSymbols) => void,
  ) {
    this.store = new AccumulatorStore(sampleRate, retentionSeconds);
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
    this.store.clear(); // accumulators and completed tapes (R6.11)
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
    switch (this.phase) {
      case 'search':
        return this.detector.keepFrom();
      case 'sync':
      case 'header':
        return this.chirpStart - this.at(FINE_TIMING_MAX_SHIFT_MS);
      case 'payload': {
        const p = this.pass!;
        // The tracker may have moved the windows far from nominal (132 ms at 0.2% over a long pass), so ask it.
        // The early probe of the previous symbol (read once this one is decided) reaches one symbol
        // plus up to 18 ms back; keep that too, or a chunked stream would skip readings a whole
        // stream makes, and the windows would differ (found by P16 with 1001-sample chunks).
        return this.symbolStart(p.payloadStartMs, p.next, p.profile, p.gate).start - this.at(p.profile.symbolMs + TRACKING_SLACK_MS);
      }
    }
  }

  /**
   * Where symbol k's analysis window starts: the symbol's nominal time, plus the shift fine timing
   * found, plus where the gate wants windows kept, plus what the clock tracker says the receiver's
   * clock has drifted by since.
   */
  private symbolStart(startMs: number, k: number, profile: Profile, gate: Gate): { start: number; nominal: number } {
    const nominal = this.at(startMs + k * profile.symbolMs + profile.guardMs);
    return { start: this.chirpStart + this.shift + gate.targetShift + nominal + Math.round(this.clock.predict(nominal)), nominal };
  }

  /**
   * One early/late reading from a decided symbol: the energy of its tone in a window shifted
   * earlier and one shifted later. Skipped when the decision was unclear, or when a neighbour
   * carries the same tone (its energy would leak into the probe and look like a timing error).
   */
  private track(profile: Profile, gate: Gate, tones: Uint8Array, confidence: Float64Array, starts: Float64Array, nominals: Float64Array, k: number): void {
    if (!gate.usable || k < 0 || confidence[k]! < MIN_TRACKING_CONFIDENCE) return;
    if ((k > 0 && tones[k - 1] === tones[k]) || tones[k + 1] === tones[k]) return;
    const length = analysisSamples(profile, this.sampleRate);
    const early = this.buffer.view(starts[k]! - gate.earlyProbe, length);
    const late = this.buffer.view(starts[k]! + gate.lateProbe, length);
    if (!early || !late) return;
    const freq = profile.tonesHz[tones[k]!]!;
    const earlyEnergy = goertzelEnergy(early, freq, this.sampleRate);
    const lateEnergy = goertzelEnergy(late, freq, this.sampleRate);
    if (!(earlyEnergy > 0) || !(lateEnergy > 0)) return;
    this.clock.update(nominals[k]!, gate.latenessOf(Math.log(lateEnergy / earlyEnergy)));
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
    // The whole header is read in one go, so wait for its last window plus room for drift and the late probe.
    if (this.buffer.end < lastStart + length + this.at(TRACKING_SLACK_MS)) {
      if (final) this.discard('signal-lost', this.buffer.end);
      return false;
    }
    const gate = calibrateGate(robust, this.sampleRate);
    this.clock = new ClockTracker(this.at(this.headerStartMs));
    const tones = new Uint8Array(this.headerSymbols);
    const confidence = new Float64Array(this.headerSymbols);
    const starts = new Float64Array(this.headerSymbols);
    const nominals = new Float64Array(this.headerSymbols);
    let headerLevel = 0;
    for (let k = 0; k < this.headerSymbols; k++) {
      const { start, nominal } = this.symbolStart(this.headerStartMs, k, robust, gate);
      starts[k] = start;
      nominals[k] = nominal;
      const segment = this.buffer.view(start, length);
      if (segment) {
        const energies = goertzelEnergies(segment, robust.tonesHz, this.sampleRate);
        headerLevel += toneLevel(energies, length) / this.headerSymbols;
        const d = decide(normalizeEnergies(energies));
        tones[k] = d.tone;
        confidence[k] = d.confidence;
      }
      this.track(robust, gate, tones, confidence, starts, nominals, k - 1);
    }
    const header = tonesToHeader(tones, this.table);
    this.onHeaderSymbols?.({ chirpStart: this.chirpStart, shift: this.shift, tones: tones.slice(), confidence: confidence.slice(), valid: header.ok });
    const payloadStartMs = this.headerStartMs + this.headerSymbols * robust.symbolMs;
    if (!header.ok) {
      this.discard('header-invalid', this.chirpStart + this.at(payloadStartMs));
      return true;
    }
    const profile = profileById(this.table, header.value.profileId)!;
    const symbols = payloadSymbolCount(geometry(header.value.payloadLength), profile);
    // Retention is judged in audio time, at the moment this pass starts: tapes idle for ten minutes are gone (R6.8).
    this.store.expire(this.chirpStart);
    const known = this.store.peek(header.value.tapeId); // "known" means an accumulator is held (R6.1)
    const passNumber = (known?.received ?? 0) + 1;
    this.pass = {
      header: header.value,
      profile,
      passNumber,
      symbols,
      payloadStartMs,
      totalMs: frameLayout(symbols, profile, robust).totalMs,
      gate: calibrateGate(profile, this.sampleRate),
      repeat: known?.completed !== undefined,
      pending: new Float64Array(symbols * profile.tonesHz.length),
      tones: new Uint8Array(symbols),
      confidence: new Float64Array(symbols),
      starts: new Float64Array(symbols),
      nominals: new Float64Array(symbols),
      headerLevel,
      levels: new Float64Array(symbols),
      lastProgressMs: 0,
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
      const { start, nominal } = this.symbolStart(p.payloadStartMs, p.next, p.profile, p.gate);
      const segment = this.buffer.view(start, length);
      if (!segment) break;
      const energies = goertzelEnergies(segment, p.profile.tonesHz, this.sampleRate);
      const shares = normalizeEnergies(energies);
      p.pending.set(shares, p.next * p.profile.tonesHz.length);
      p.levels[p.next] = toneLevel(energies, length);
      const d = decide(shares);
      p.tones[p.next] = d.tone;
      p.confidence[p.next] = d.confidence;
      p.starts[p.next] = start;
      p.nominals[p.next] = nominal;
      // The reading for the previous symbol needs this one decided, to know whether the neighbours share its tone.
      this.track(p.profile, p.gate, p.tones, p.confidence, p.starts, p.nominals, p.next - 1);
      p.next++;
      progressed = true;
      if (this.signalLost(p)) {
        this.discard('signal-lost', start + length);
        return true;
      }
      this.maybeProgress(p);
    }
    if (p.next === p.symbols) {
      this.finishPass(p);
      return true;
    }
    if (final) this.discard('signal-lost', this.buffer.end);
    return progressed;
  }

  /**
   * Has the ghost stopped? True when the mean tone level of the last SIGNAL_LOST_WINDOW_MS of
   * payload is 30 dB below the header's. A dropout of up to 150 ms leaves at least 250 ms of
   * signal in the window, so its mean stays within about 2 dB of normal and the pass goes on;
   * the end of a recording, or the speaker switched off, drops it to the noise floor.
   */
  private signalLost(p: PassState): boolean {
    const span = Math.ceil(SIGNAL_LOST_WINDOW_MS / p.profile.symbolMs);
    if (p.next < span) return false;
    let sum = 0;
    for (let k = p.next - span; k < p.next; k++) sum += p.levels[k]!;
    return sum / span < SIGNAL_LOST_RATIO * p.headerLevel;
  }

  /**
   * Emit `progress` so that no gap exceeds PROGRESS_INTERVAL_MS of payload time: after symbol k
   * when waiting for one more symbol would overshoot the interval (R8.3). The cadence is counted
   * in symbols, which are fixed points of the stream, so it does not depend on chunking. Repeat
   * passes of a completed tape send none (R8.17), and the last symbol sends none because the
   * pass result follows at once.
   */
  private maybeProgress(p: PassState): void {
    if (p.repeat || p.next >= p.symbols) return;
    const symbolMs = p.profile.symbolMs;
    if ((p.next + 1) * symbolMs - p.lastProgressMs <= PROGRESS_INTERVAL_MS) return;
    p.lastProgressMs = p.next * symbolMs;
    const provisional = this.provisional(p);
    this.events.push({ type: 'progress', tapeId: p.header.tapeId, provisional, fractionReceived: p.next / p.symbols });
  }

  /**
   * Provisional bytes from the tape's accumulator plus this pass so far (R8.9). A symbol has
   * evidence when some pass put energy into it; the bytes it carries are shown, decided from the
   * summed shares, with no error correction (they are not verified).
   */
  private provisional(p: PassState): ProvisionalByte[] {
    const tones = p.profile.tonesHz.length;
    const held = this.store.peek(p.header.tapeId);
    const sums = held && held.profileName === p.profile.name && held.payloadLength === p.header.payloadLength && held.symbols === p.symbols && held.tones === tones ? held.sums : undefined;
    const combined = sums ? sums.slice() : new Float64Array(p.symbols * tones);
    const fresh = p.next * tones;
    for (let i = 0; i < fresh; i++) combined[i]! += p.pending[i]!;
    const decided = decideFromSums(combined, p.symbols, tones);
    const evidence = new Uint8Array(p.symbols);
    for (let s = 0; s < p.symbols; s++) {
      for (let t = 0; t < tones; t++) {
        if (combined[s * tones + t]! > 0) {
          evidence[s] = 1;
          break;
        }
      }
    }
    const bytes = provisionalBytes(decided.tones, decided.confidence, evidence, p.header.payloadLength, p.profile);
    return bytes.ok ? bytes.value : [];
  }

  /**
   * A pass has been read to its end. What happens next depends on what the decoder already knows:
   *  - the tape is complete and retained: a repeat. Say so, touch nothing but its activity time (R8.17);
   *  - the pass is not aligned (its pilots were not read as pilots): discard it, the accumulator
   *    stays exactly as if the pass never came (R6.6, R8.6);
   *  - otherwise add this pass's energies to the tape's accumulator, decide every symbol from the
   *    sums, and run the verification chain (R7.2): every RS block, the CRC trailer, the tapeId,
   *    the strict parse. Only then is there a `complete`.
   */
  private finishPass(p: PassState): void {
    const { header, profile } = p;
    this.onPassSymbols?.({ tapeId: header.tapeId, profile: profile.name, tones: p.tones.slice(), confidence: p.confidence.slice() });
    // Resume after the postamble so the down-chirp is never mistaken for a new pass. The pass may
    // have arrived early or late by the tracked clock error, so the end moves with it.
    this.pass = undefined;
    const end = this.at(p.totalMs);
    const resumeAt = this.chirpStart + this.shift + end + Math.round(this.clock.predict(end));
    this.backToSearch(resumeAt);

    if (p.repeat) {
      this.store.noteRepeat(header.tapeId, p.passNumber, this.chirpStart);
      this.events.push({ type: 'already-received', tapeId: header.tapeId });
      return;
    }
    const tones = profile.tonesHz.length;
    if (!isAligned(p.pending, p.symbols, tones, profile.pilotEvery, profile.pilotIndex)) {
      this.events.push({ type: 'pass-discarded', reason: 'alignment-failed' });
      return;
    }
    const { tape } = this.store.commit(
      { tapeId: header.tapeId, profileName: profile.name, payloadLength: header.payloadLength, symbols: p.symbols, tones },
      p.pending,
      p.passNumber,
      this.chirpStart,
    );
    const decided = decideFromSums(tape.sums, p.symbols, tones);
    const blocks = decodePayloadBlocks(decided.tones, header.payloadLength, profile);
    const blocksTotal = geometry(header.payloadLength).blocks;
    const blocksRecovered = blocks.ok ? blocks.value.blocks.filter((b) => b !== undefined).length : 0;
    this.events.push({ type: 'pass-complete', tapeId: header.tapeId, pass: p.passNumber, blocksRecovered, blocksTotal, clarity: decided.clarity });

    if (blocks.ok && blocksRecovered === blocksTotal) {
      const assembled = assemblePayload(blocks.value);
      if (assembled.ok && assembled.value.crc === header.tapeId) {
        const payload = deserializePayload(assembled.value.payload);
        if (payload.ok) {
          tape.completed = payload.value;
          this.events.push({ type: 'complete', tapeId: header.tapeId, payload: payload.value, passesUsed: tape.passes });
        }
      }
    }
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
  return new StreamDecoder(options.sampleRate, table, options.onPassSymbols, options.retentionSeconds, options.onHeaderSymbols);
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
  return summarizeEvents([...decoder.push(samples), ...decoder.flush()]);
}

/**
 * What decodeFile reports for a finished stream's events: the first verified payload, or why
 * there is none. Shared with callers that also want the events themselves (the decoder worker).
 */
export function summarizeEvents(events: readonly DecoderEvent[]): DecodeFileResult {
  const complete = events.find((e): e is Extract<DecoderEvent, { type: 'complete' }> => e.type === 'complete');
  if (complete) return { ok: true, payload: complete.payload, passesUsed: complete.passesUsed };
  let clarity = 0;
  for (const e of events) if (e.type === 'pass-complete') clarity = e.clarity;
  const sawHeader = events.some((e) => e.type === 'header');
  return { ok: false, reason: sawHeader ? 'a ghost track was found but the tape is not yet developed' : 'no signal found', clarity };
}
