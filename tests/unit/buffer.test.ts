import { describe, expect, it } from 'vitest';
import { SampleBuffer } from '../../src/modem/buffer';

describe('SampleBuffer', () => {
  it('addresses samples by absolute index across appends', () => {
    const b = new SampleBuffer();
    b.append(Float32Array.of(1, 2, 3));
    b.append(Float32Array.of(4, 5));
    b.append(new Float32Array(0));
    expect(b.end).toBe(5);
    expect([...b.view(1, 3)!]).toEqual([2, 3, 4]);
    expect(b.view(3, 3)).toBeUndefined(); // runs past the end
    expect(b.view(-1, 2)).toBeUndefined();
  });

  it('turns NaN and infinities into silence (R11.6)', () => {
    const b = new SampleBuffer();
    b.append(Float32Array.of(NaN, Infinity, -Infinity, 0.5));
    expect([...b.view(0, 4)!]).toEqual([0, 0, 0, 0.5]);
  });

  it('grows past its initial capacity without losing data', () => {
    const b = new SampleBuffer();
    const big = Float32Array.from({ length: 300000 }, (_, i) => i % 1000);
    b.append(big.subarray(0, 100000));
    b.append(big.subarray(100000));
    expect(b.end).toBe(300000);
    expect(b.view(299990, 10)).toEqual(big.subarray(299990));
  });

  it('trims from the front, keeps absolute indices, and treats trimmed or future samples as silence in copyRange', () => {
    const b = new SampleBuffer();
    b.append(Float32Array.from({ length: 300000 }, (_, i) => (i % 7) + 1));
    b.trimBefore(250000);
    expect(b.base).toBe(250000);
    expect(b.end).toBe(300000);
    expect(b.view(249999, 2)).toBeUndefined();
    expect(b.view(250000, 3)).toEqual(Float32Array.of((250000 % 7) + 1, (250001 % 7) + 1, (250002 % 7) + 1));
    const out = new Float64Array(6);
    b.copyRange(249998, 6, out);
    expect([...out]).toEqual([0, 0, (250000 % 7) + 1, (250001 % 7) + 1, (250002 % 7) + 1, (250003 % 7) + 1]);
    b.copyRange(299998, 4, out);
    expect([...out.subarray(0, 4)]).toEqual([(299998 % 7) + 1, (299999 % 7) + 1, 0, 0]);
  });

  it('ignores small or backwards trims (cost is amortised) and clear() restarts at a position', () => {
    const b = new SampleBuffer();
    b.append(Float32Array.of(1, 2, 3, 4));
    b.trimBefore(2);
    b.trimBefore(0);
    expect(b.end).toBe(4);
    expect([...b.view(2, 2)!]).toEqual([3, 4]);
    b.clear(1000);
    expect([b.base, b.end]).toEqual([1000, 1000]);
    b.append(Float32Array.of(9));
    expect([...b.view(1000, 1)!]).toEqual([9]);
  });
});
