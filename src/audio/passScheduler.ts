// Side B: start one pass at an exact audio-clock time. Scheduling on the audio clock, not with
// setTimeout, keeps the gap between passes exact however busy the main thread is.

export function schedulePass(context: AudioContext, samples: Float32Array, sampleRate: number, atSec: number): { cancel(): void } {
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  // A time already in the past starts at once, which is the best a late caller can get.
  source.start(Math.max(atSec, context.currentTime));
  return {
    cancel: () => {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
    },
  };
}
