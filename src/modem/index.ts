// Public API of the modem library. createDecoder and decodeFile are added as their
// tasks land (tasks 9 and 13).
export { encodePayload } from './modulate';
export type { EncodedTrack, EncodeOptions } from './modulate';
export { PROFILES, ROBUST, STANDARD } from './profiles';
export type { Profile, ProfileTable } from './profiles';
export type {
  DecodeFileResult,
  Decoder,
  DecoderEvent,
  DiscardReason,
  Ghost,
  Payload,
  ProfileId,
  ProvisionalByte,
  Result,
  Tape,
} from './types';
