// Public API of the modem library.
export { createDecoder, decodeFile, summarizeEvents } from './decoder';
export type { DecoderOptions, PassSymbols } from './decoder';
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
