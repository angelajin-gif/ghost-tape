// Public types of the modem library (design.md, "Events" and "Public API").

/**
 * Profile identifier, e.g. 'robust' or 'standard'.
 * A plain string because profile tables can be injected at runtime (R9.7);
 * profiles.ts validates ids against the table in use.
 */
export type ProfileId = string;

/** Side A: a J-card plus a letter. All text uses the Ghost Tape charset. */
export interface Tape {
  readonly kind: 'tape';
  readonly title: string;
  readonly from: string;
  readonly to: string;
  /** `YYYY-MM-DD`, or undefined when the date is absent. */
  readonly date?: string;
  readonly tracks: readonly string[];
  readonly letter: string;
  /** 32×32 1-bit doodle, 128 bytes row-major (cut-list feature, R2.2). */
  readonly doodle?: Uint8Array;
}

/** Side B: a short broadcast message. */
export interface Ghost {
  readonly kind: 'ghost';
  readonly message: string;
}

/** A verified payload. Only `complete` events and decodeFile successes carry one. */
export type Payload = Tape | Ghost;

/**
 * A byte that has not been verified yet. Its `kind` differs from every Payload
 * variant, so it can never be passed where a Payload is expected (R7.7, R7.8).
 */
export interface ProvisionalByte {
  readonly kind: 'provisional';
  /** Position in the final payload, 0..payloadLength-1. */
  readonly position: number;
  readonly byte: number;
  /** 0..1, minimum symbol confidence of the symbols carrying this byte. */
  readonly confidence: number;
}

/** Decoders never throw; they return this instead. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export type DiscardReason = 'header-invalid' | 'alignment-failed' | 'signal-lost';

export type DecoderEvent =
  | { readonly type: 'signal-detected'; readonly atSample: number }
  | {
      readonly type: 'header';
      readonly tapeId: number;
      readonly profile: ProfileId;
      readonly payloadLength: number;
      /** 1-based count of passes received for this tapeId, including this one. */
      readonly pass: number;
      readonly estimatedSecondsRemaining: number;
    }
  | {
      readonly type: 'progress';
      readonly tapeId: number;
      readonly provisional: readonly ProvisionalByte[];
      readonly fractionReceived: number;
    }
  | {
      readonly type: 'pass-complete';
      readonly tapeId: number;
      readonly pass: number;
      readonly blocksRecovered: number;
      readonly blocksTotal: number;
      readonly clarity: number;
    }
  | { readonly type: 'complete'; readonly tapeId: number; readonly payload: Payload; readonly passesUsed: number }
  | { readonly type: 'already-received'; readonly tapeId: number }
  | { readonly type: 'pass-discarded'; readonly reason: DiscardReason };

/** Streaming decoder (R4). Accepts chunks of any length; never throws. */
export interface Decoder {
  push(samples: Float32Array): DecoderEvent[];
  flush(): DecoderEvent[];
  reset(): void;
}

export type DecodeFileResult =
  | { readonly ok: true; readonly payload: Payload; readonly passesUsed: number }
  | { readonly ok: false; readonly reason: string; readonly clarity: number };
