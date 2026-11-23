// The parts of src/audio that do not need a browser: mono mixing, file-decode failure handling
// and the microphone constraints. The browser paths are checked by hand (task 15 manual check).
import { describe, expect, it } from 'vitest';
import { decodeAudioFile, mixToMono, UNREADABLE_FILE, type ChannelSource, type DecodeContext } from '../../src/audio/file';
import { MIC_CONSTRAINTS } from '../../src/audio/mic';

const source = (channels: number[][], sampleRate = 48000): ChannelSource => ({
  numberOfChannels: channels.length,
  length: channels[0]?.length ?? 0,
  sampleRate,
  getChannelData: (c) => Float32Array.from(channels[c]!),
});
const contextGiving = (decode: (data: ArrayBuffer) => Promise<ChannelSource>): DecodeContext => ({ decodeAudioData: decode });

describe('mixToMono (R3.9)', () => {
  it('averages all channels sample by sample', () => {
    expect(mixToMono(source([[1, 0.5, -1], [0, 0.5, 1]]))).toEqual(Float32Array.from([0.5, 0.5, 0]));
    expect(mixToMono(source([[0.3], [0.6], [0.9]]))[0]).toBeCloseTo(0.6, 6);
  });

  it('returns one channel as a copy', () => {
    const data = Float32Array.from([0.1, 0.2]);
    const one: ChannelSource = { numberOfChannels: 1, length: 2, sampleRate: 44100, getChannelData: () => data };
    const mono = mixToMono(one);
    expect(mono).toEqual(data);
    mono[0] = 9;
    expect(data[0]).toBeCloseTo(0.1, 6);
  });
});

describe('decodeAudioFile (R3.7, R3.10)', () => {
  it('passes the samples on at the decoding context rate', async () => {
    const r = await decodeAudioFile(new ArrayBuffer(8), contextGiving(async () => source([[0.25, -0.25], [0.75, 0.25]], 48000)));
    expect(r).toEqual({ ok: true, value: { samples: Float32Array.from([0.5, 0]), sampleRate: 48000 } });
  });

  it('a rejected, throwing or empty decode becomes the one unreadable-file reason, never an exception', async () => {
    const failing: DecodeContext[] = [
      contextGiving(() => Promise.reject(new DOMException('bad data', 'EncodingError'))),
      contextGiving(() => {
        throw new TypeError('detached');
      }),
      contextGiving(async () => source([[]])),
      contextGiving(async () => ({ numberOfChannels: 0, length: 10, sampleRate: 48000, getChannelData: () => new Float32Array(10) })),
    ];
    for (const ctx of failing) expect(await decodeAudioFile(new ArrayBuffer(4), ctx)).toEqual({ ok: false, reason: UNREADABLE_FILE });
    expect(UNREADABLE_FILE).toBe('unsupported or unreadable audio file');
  });

  it("hands decodeAudioData a copy, so the caller's buffer is not detached", async () => {
    const original = new Uint8Array([1, 2, 3, 4]).buffer;
    let given: ArrayBuffer | undefined;
    await decodeAudioFile(original, contextGiving(async (data) => ((given = data), source([[0]]))));
    expect(given).not.toBe(original);
    expect(original.byteLength).toBe(4);
  });
});

describe('microphone constraints (R4.1)', () => {
  it('turn echo cancellation, noise suppression and automatic gain control off', () => {
    expect(MIC_CONSTRAINTS.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  });
});
