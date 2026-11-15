// Growing sample store addressed by absolute stream index.
//
// The decoder sees audio in arbitrary chunks, but every decision it makes must depend
// only on the concatenated stream. So everything is addressed by "sample number since
// the stream began", never by position inside a chunk, and old samples are dropped
// only from the front when nothing will look at them again.

export class SampleBuffer {
  private data = new Float32Array(1 << 16);
  private length = 0;
  /** Absolute index of the first stored sample. */
  base = 0;

  /** Absolute index one past the last stored sample (= samples received so far). */
  get end(): number {
    return this.base + this.length;
  }

  /** Append samples; NaN and ±Infinity become 0 (R11.6). */
  append(samples: Float32Array): void {
    if (samples.length === 0) return;
    const needed = this.length + samples.length;
    if (needed > this.data.length) {
      let capacity = this.data.length;
      while (capacity < needed) capacity *= 2;
      const grown = new Float32Array(capacity);
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]!;
      this.data[this.length + i] = Number.isFinite(x) ? x : 0;
    }
    this.length = needed;
  }

  /** A read-only window onto [start, start+length), or undefined if any of it is not stored. No copy. */
  view(start: number, length: number): Float32Array | undefined {
    if (start < this.base || start + length > this.end || length < 0) return undefined;
    return this.data.subarray(start - this.base, start - this.base + length);
  }

  /** Copy [start, start+length) into `out`, treating anything not stored (dropped or not yet received) as silence. */
  copyRange(start: number, length: number, out: Float64Array): void {
    for (let i = 0; i < length; i++) {
      const abs = start + i;
      out[i] = abs >= this.base && abs < this.end ? this.data[abs - this.base]! : 0;
    }
  }

  /** Forget samples before `position`. Compacts lazily so the cost is amortised. */
  trimBefore(position: number): void {
    const drop = Math.min(position, this.end) - this.base;
    if (drop <= 0) return;
    if (drop < 1 << 16 && drop * 2 < this.length) return;
    this.data.copyWithin(0, drop, this.length);
    this.length -= drop;
    this.base += drop;
  }

  /** Start over with an empty buffer whose next sample has absolute index `position`. */
  clear(position: number): void {
    this.length = 0;
    this.base = position;
  }
}
