// Maps the free-text failure of mic.ts `startListening` to the port's MicFailure codes.
// Pure, so it is tested in Node. It lives apart from audioPortImpl.ts, which imports the worklet URL.

import type { MicFailure } from '../ui/audioPort';

export interface MicFailureFacts {
  /** `window.isSecureContext`. getUserMedia is unavailable on plain HTTP. */
  readonly secureContext: boolean;
  /** Whether enumerateDevices lists at least one audio input; true when it could not be asked. */
  readonly hasAudioInput: boolean;
}

export function classifyMicFailure(reason: string, facts: MicFailureFacts): MicFailure {
  if (!facts.secureContext) return 'insecure-context';
  if (reason.includes('permission was refused')) return 'denied';
  if (!facts.hasAudioInput) return 'no-microphone';
  return 'failed';
}
