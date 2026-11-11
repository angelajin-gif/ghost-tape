import type { Profile } from '../../src/modem/profiles';

/**
 * A made-up 8-tone, 3-bit profile used to show nothing is hardcoded to the two
 * built-in profiles (R9.7). All tones sit on the 50 Hz grid of a 20 ms window.
 */
export const PENTATONIC: Profile = {
  name: 'pentatonic',
  id: 7,
  tonesHz: [1200, 1350, 1500, 1800, 2000, 2400, 2700, 3000],
  bitsPerSymbol: 3,
  symbolMs: 25,
  guardMs: 5,
  analysisMs: 20,
  envelope: 'flat',
  pilotIndex: 7,
  pilotEvery: 32,
  capBytes: 512,
};
