// AudioWorklet processor: forwards every 128-sample render quantum of the microphone, mixed to
// mono, to the decoder worker over a MessagePort (design "Audio adapters", R4.1). It runs on the
// audio thread, so it does no decoding at all: copy, post, return.

import { CAPTURE_PROCESSOR, type CaptureFrame, type WorkletAttach } from './protocol';

// The worklet global scope is not in the DOM lib; declare the names used here.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
/** The audio clock: index of the first sample of the current render quantum. */
declare const currentFrame: number;

class CaptureProcessor extends AudioWorkletProcessor {
  private out: MessagePort | undefined;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<WorkletAttach>) => {
      if (event.data?.type === 'attach') this.out = event.data.port;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!this.out || !channels || channels.length === 0) return true;
    const frame = new Float32Array(channels[0]!.length);
    for (const channel of channels) for (let i = 0; i < frame.length; i++) frame[i]! += channel[i]!;
    if (channels.length > 1) for (let i = 0; i < frame.length; i++) frame[i]! /= channels.length;
    // Transfer, not copy: the frame is ours and the worker is its only reader. The audio clock
    // goes with it, so the worker can see quanta that never reached us and keep time across them.
    const message: CaptureFrame = { frame: currentFrame, samples: frame };
    this.out.postMessage(message, [frame.buffer]);
    return true;
  }
}

registerProcessor(CAPTURE_PROCESSOR, CaptureProcessor);
