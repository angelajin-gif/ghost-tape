// The Carrier profile table (R27): the only place in src/ui that maps a Carrier to a modem profile.
// Views and the composer ask this table; they never name a profile (R27.1, R27.6).
import { PROFILES, profileByName } from '../modem/profiles';
import type { ProfileId } from '../modem/types';

export type Carrier = 'link' | 'file' | 'broadcast' | 'demo';

export const CARRIER_PROFILE: Readonly<Record<Carrier, ProfileId>> = {
  link: 'standard',
  file: 'standard',
  // Broadcast messages are at most 140 characters (142 serialized bytes), under Robust's cap, and
  // Robust tolerates the loudspeaker-and-room path that Side B is for.
  broadcast: 'robust',
  demo: 'standard',
};

export function carrierProfile(carrier: Carrier): ProfileId {
  return CARRIER_PROFILE[carrier];
}

/** Largest serialized payload (bytes) the Carrier's profile may carry. */
export function capBytes(carrier: Carrier): number {
  const profile = profileByName(PROFILES, CARRIER_PROFILE[carrier]);
  // Unreachable while the table above only names built-in profiles; 0 makes any tape "too long".
  return profile ? profile.capBytes : 0;
}
