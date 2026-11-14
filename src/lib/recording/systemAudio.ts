import type { SystemAudioSupport, SystemAudioUnsupportedReason } from '../../types';

const NOTICE_KEYS: Record<SystemAudioUnsupportedReason, string> = {
  'macos-too-old': 'systemAudioUnsupported_macosTooOld',
  'linux-not-supported': 'systemAudioUnsupported_linux',
  'platform-not-supported': 'systemAudioUnsupported_platform',
};

/**
 * The `toolbar` namespace key explaining why system audio won't be in the
 * recording, or null when it will be (or support isn't known yet).
 */
export function getSystemAudioNoticeKey(support: SystemAudioSupport | null): string | null {
  if (!support || support.supported) {
    return null;
  }
  return NOTICE_KEYS[support.reason];
}
