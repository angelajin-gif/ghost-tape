// Messages between the UI thread, the capture worklet and the decoder worker.
//
//   microphone -> AudioWorklet (128-sample frames) --MessagePort--> Worker (owns the decoder)
//   Worker --events--> UI thread
//
// The worklet talks to the worker directly over a MessageChannel, so audio never waits for the
// UI thread; only decoder events come back to it.

import type { DecodeFileResult, DecoderEvent } from '../modem/types';

export type ToWorker =
  | { readonly type: 'start'; readonly sampleRate: number }
  /** The worklet's end of the audio channel; every message on it is one Float32Array frame. */
  | { readonly type: 'attach'; readonly port: MessagePort }
  | { readonly type: 'samples'; readonly samples: Float32Array }
  | { readonly type: 'flush' }
  | { readonly type: 'reset' }
  | { readonly type: 'decode-file'; readonly samples: Float32Array; readonly sampleRate: number };

export type FromWorker =
  /**
   * `pushedSamples`: audio received by the decoder so far, for showing audio time.
   * `levelDb`: RMS level of the audio since the previous message, in dB relative to full scale.
   * `gapSamples`: samples the audio clock skipped so far (filled with silence to keep time).
   */
  | { readonly type: 'events'; readonly events: readonly DecoderEvent[]; readonly pushedSamples: number; readonly levelDb: number; readonly gapSamples: number }
  | { readonly type: 'file-result'; readonly result: DecodeFileResult; readonly events: readonly DecoderEvent[] }
  | { readonly type: 'error'; readonly message: string };

/** One render quantum from the capture worklet, stamped with the audio clock (sample index). */
export interface CaptureFrame {
  readonly frame: number;
  readonly samples: Float32Array;
}

/** Message sent to the capture worklet on its own port to hand it the worker's channel. */
export interface WorkletAttach {
  readonly type: 'attach';
  readonly port: MessagePort;
}

/** Name the worklet registers its processor under. */
export const CAPTURE_PROCESSOR = 'ghost-tape-capture';
