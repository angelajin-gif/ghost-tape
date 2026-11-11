// Symbols -> samples: MFSK tones, chirps and the music-box envelope
// (design.md "Modulation", requirements 1 and 9).
//
// A "ghost track" is one pass (or N passes) of:
//   [up-chirp][gap][sync][header][payload + pilots][down-chirp]
// Pure functions on numbers and Float32Array; no Web Audio.

import {
  buildFrameSymbols,
  CHIRP_HIGH_HZ,
  CHIRP_LOW_HZ,
  frameLayout,
  POSTAMBLE_MS,
  PREAMBLE_MS,
  sampleAtMs,
  type FrameSymbols,
} from './frame';
import {
  HEADER_PROFILE_NAME,
  profileByName,
  PROFILES,
  validateProfileTable,
  type EnvelopeKind,
  type Profile,
  type ProfileTable,
} from './profiles';
import { serializeWithinCap } from './tape';
import type { Payload, ProfileId, Result } from './types';

/** Peak absolute amplitude of every pass, inside the required 0.5–0.9 (R1.8). */
export const PEAK_LEVEL = 0.8;
/** Raised-cosine fade at the two edges of the tone stream, where it meets silence or a chirp. */
export const FADE_MS = 2;
/** Raised-cosine taper at both ends of each chirp. */
export const CHIRP_TAPER_MS = 20;
/** Robust bell envelope: rises from BELL_FLOOR to 1.0 in the first BELL_RISE_MS, then decays back to BELL_FLOOR (R1.11, R1.12). */
export const BELL_RISE_MS = 3;
export const BELL_FLOOR = 0.6;
/**
 * Frequency glide at the start of each symbol: the pitch eases from the previous tone to the
 * new one along a raised cosine instead of jumping. A jump leaves a kink in the wave, and kinks
 * splatter energy upward; measured without the glide, Robust symbols were only 34 dB below the
 * telephone band at 4 kHz (R1.7 needs 40). The glide always sits inside the guard period the
 * decoder skips, so it never touches the part of the symbol that is measured.
 */
export const GLIDE_MS = 2;
/** Silence between looped passes (R1.9), in seconds. */
export const LOOP_GAP_SECONDS = 1;
export const SUPPORTED_SAMPLE_RATES: readonly number[] = [44100, 48000];
/** Refuse outputs beyond ~1 GB of Float32 rather than run out of memory. */
export const MAX_OUTPUT_SAMPLES = 2 ** 28;

const TWO_PI = 2 * Math.PI;

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Half a cosine from 0 to 1 over `x` in [0, 1]: a smooth ramp with zero slope at both ends. */
const raisedCosine = (x: number): number => 0.5 * (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, x))));

/**
 * Amplitude multiplier at `tMs` into a symbol.
 * Flat: always 1. Bell (music box): starts at 0.6, rises smoothly to 1.0 by 3 ms
 * (a struck note), then decays exponentially back to 0.6 at the symbol's end. The
 * end level equals the start level, so amplitude is continuous from symbol to symbol.
 */
export function symbolEnvelope(kind: EnvelopeKind, tMs: number, symbolMs: number): number {
  if (kind === 'flat') return 1;
  if (tMs < BELL_RISE_MS) return BELL_FLOOR + (1 - BELL_FLOOR) * raisedCosine(tMs / BELL_RISE_MS);
  return Math.pow(BELL_FLOOR, (tMs - BELL_RISE_MS) / (symbolMs - BELL_RISE_MS));
}

/**
 * Linear chirp into out[start, end). Instantaneous frequency moves from f0 to f1
 * over `durationMs`; its phase is the integral of that frequency,
 * phi(t) = 2π (f0·t + (f1 − f0)·t² / (2T)). Tapered at both ends so it starts and
 * stops without a click.
 */
export function renderChirp(out: Float32Array, startSample: number, endSample: number, f0Hz: number, f1Hz: number, durationMs: number, sampleRate: number): void {
  const durationSec = durationMs / 1000;
  const taperSec = CHIRP_TAPER_MS / 1000;
  const length = endSample - startSample;
  for (let n = 0; n < length; n++) {
    const t = n / sampleRate;
    const fromEnd = (length - 1 - n) / sampleRate;
    const edge = Math.min(t, fromEnd);
    const taper = edge < taperSec ? raisedCosine(edge / taperSec) : 1;
    out[startSample + n] = taper * Math.sin(TWO_PI * (f0Hz * t + ((f1Hz - f0Hz) * t * t) / (2 * durationSec)));
  }
}

interface ToneRun {
  readonly startMs: number;
  readonly symbolMs: number;
  /** Length of the frequency glide at each symbol start; never longer than the profile's guard. */
  readonly glideMs: number;
  readonly tones: Uint8Array;
  readonly tonesHz: readonly number[];
  readonly envelope: EnvelopeKind;
  readonly fadeIn: boolean;
  readonly fadeOut: boolean;
}

/** Oscillator state shared by consecutive runs so the sine never jumps. */
interface Oscillator {
  phase: number;
  /** Frequency of the previous symbol; undefined before the first one. */
  freqHz: number | undefined;
  /** Envelope level at the end of the previous symbol; undefined before the first one. */
  level: number | undefined;
}

/**
 * Write consecutive symbols. The oscillator phase is carried across symbol
 * boundaries (continuous-phase FSK): the wave never jumps, only its frequency
 * changes, which keeps clicks (and the energy they splatter into other tones) out.
 * Each phase step is 2π·f/fs, the angle a tone of frequency f advances per sample.
 */
function renderToneRun(out: Float32Array, run: ToneRun, sampleRate: number, osc: Oscillator): void {
  const fadeSamples = (FADE_MS / 1000) * sampleRate;
  const glideSamples = (run.glideMs / 1000) * sampleRate;
  const runEnd = sampleAtMs(run.startMs + run.tones.length * run.symbolMs, sampleRate);
  for (let k = 0; k < run.tones.length; k++) {
    // Start = round(exact time · rate): no drift even when a symbol is 1102.5 samples long (R1.13).
    const start = sampleAtMs(run.startMs + k * run.symbolMs, sampleRate);
    const end = sampleAtMs(run.startMs + (k + 1) * run.symbolMs, sampleRate);
    const targetHz = run.tonesHz[run.tones[k]!]!;
    const fromHz = osc.freqHz ?? targetHz; // the very first symbol has nothing to glide from
    // Level step to smooth away. Bell->bell and flat->flat have none (the bell ends where it
    // starts), so the bell's own 3 ms rise is untouched. Robust header -> Standard payload does:
    // 0.6 -> 1.0 at the hand-over, which would be a loudness jump and splatter.
    const levelJump = osc.level === undefined ? 0 : osc.level - symbolEnvelope(run.envelope, 0, run.symbolMs);
    for (let n = start; n < end; n++) {
      const glide = raisedCosine((n - start) / glideSamples); // 0 -> 1 over the glide, then stays 1
      const hz = fromHz + (targetHz - fromHz) * glide;
      osc.phase += (TWO_PI * hz) / sampleRate;
      if (osc.phase > TWO_PI) osc.phase -= TWO_PI;
      let amp = symbolEnvelope(run.envelope, ((n - start) / sampleRate) * 1000, run.symbolMs) + levelJump * (1 - glide);
      if (run.fadeIn && k === 0) amp *= raisedCosine((n - start) / fadeSamples);
      if (run.fadeOut && k === run.tones.length - 1) amp *= raisedCosine((runEnd - 1 - n) / fadeSamples);
      out[n] = amp * Math.sin(osc.phase);
    }
    osc.freqHz = targetHz;
    osc.level = symbolEnvelope(run.envelope, run.symbolMs, run.symbolMs);
  }
}

/** One complete pass, scaled so its peak is exactly PEAK_LEVEL. */
export function renderPass(frame: FrameSymbols, payloadProfile: Profile, robust: Profile, sampleRate: number): Float32Array {
  const layout = frameLayout(frame.payloadTones.length, payloadProfile, robust);
  const out = new Float32Array(sampleAtMs(layout.totalMs, sampleRate));

  renderChirp(out, 0, sampleAtMs(PREAMBLE_MS, sampleRate), CHIRP_LOW_HZ, CHIRP_HIGH_HZ, PREAMBLE_MS, sampleRate);

  const osc: Oscillator = { phase: 0, freqHz: undefined, level: undefined };
  // Sync and header are contiguous Robust symbols, so they render as one run.
  const overture = new Uint8Array(frame.syncTones.length + frame.headerTones.length);
  overture.set(frame.syncTones);
  overture.set(frame.headerTones, frame.syncTones.length);
  renderToneRun(out, { startMs: layout.syncStartMs, symbolMs: robust.symbolMs, glideMs: Math.min(GLIDE_MS, robust.guardMs), tones: overture, tonesHz: robust.tonesHz, envelope: robust.envelope, fadeIn: true, fadeOut: false }, sampleRate, osc);
  renderToneRun(out, { startMs: layout.payloadStartMs, symbolMs: payloadProfile.symbolMs, glideMs: Math.min(GLIDE_MS, payloadProfile.guardMs), tones: frame.payloadTones, tonesHz: payloadProfile.tonesHz, envelope: payloadProfile.envelope, fadeIn: false, fadeOut: true }, sampleRate, osc);

  renderChirp(out, sampleAtMs(layout.postambleStartMs, sampleRate), out.length, CHIRP_HIGH_HZ, CHIRP_LOW_HZ, POSTAMBLE_MS, sampleRate);

  // Decisions compare energies against each other, so absolute level is free to choose.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const gain = peak > 0 ? PEAK_LEVEL / peak : 1;
  for (let i = 0; i < out.length; i++) out[i]! *= gain;
  return out;
}

export interface EncodeOptions {
  /** Payload profile name, e.g. 'standard'. */
  readonly profile: ProfileId;
  /** 44100 or 48000 Hz (R1.1). */
  readonly sampleRate: number;
  /** Loop mode: N >= 1 complete passes with 1 s of silence between them. Default 1. */
  readonly passes?: number;
  /** Profile table to use instead of the built-in one (R9.7). */
  readonly profiles?: ProfileTable;
}

export interface EncodedTrack {
  readonly samples: Float32Array;
  /** Exactly samples.length / sampleRate (R1.4). */
  readonly durationSec: number;
}

/**
 * Tape or ghost -> ghost-track samples (R1). Rejects with a reason and returns no
 * audio for an unknown profile, an unsupported sample rate or pass count, an invalid
 * field, or a payload over the profile's size cap.
 */
export function encodePayload(payload: Payload, options: EncodeOptions): Result<EncodedTrack> {
  const table = options.profiles ?? PROFILES;
  const valid = validateProfileTable(table);
  if (!valid.ok) return valid;
  if (!SUPPORTED_SAMPLE_RATES.includes(options.sampleRate)) return fail(`sample rate ${options.sampleRate} Hz is not supported, use 44100 or 48000`);
  const passes = options.passes ?? 1;
  if (!Number.isInteger(passes) || passes < 1) return fail(`passes must be a whole number of at least 1, got ${passes}`);
  const profile = profileByName(table, options.profile);
  if (!profile) return fail(`unknown profile "${options.profile}"`);
  const robust = profileByName(table, HEADER_PROFILE_NAME)!;

  const serialized = serializeWithinCap(payload, profile.capBytes, profile.name);
  if (!serialized.ok) return serialized;
  const frame = buildFrameSymbols(serialized.value, profile, table);
  if (!frame.ok) return frame;

  const passLength = sampleAtMs(frameLayout(frame.value.payloadTones.length, profile, robust).totalMs, options.sampleRate);
  const gap = Math.round(LOOP_GAP_SECONDS * options.sampleRate);
  const total = passes * passLength + (passes - 1) * gap;
  if (total > MAX_OUTPUT_SAMPLES) return fail(`${passes} passes would need ${total} samples, more than the ${MAX_OUTPUT_SAMPLES} limit`);

  const pass = renderPass(frame.value, profile, robust, options.sampleRate);
  const samples = new Float32Array(total); // zero-filled: the gaps are exact digital silence
  for (let i = 0; i < passes; i++) samples.set(pass, i * (passLength + gap));
  return { ok: true, value: { samples, durationSec: samples.length / options.sampleRate } };
}
