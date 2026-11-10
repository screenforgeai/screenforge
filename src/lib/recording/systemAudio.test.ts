import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { getSystemAudioNoticeKey } from './systemAudio';

describe('getSystemAudioNoticeKey', () => {
  it('has no notice when system audio is recorded', () => {
    expect(getSystemAudioNoticeKey({ supported: true })).toBeNull();
    expect(getSystemAudioNoticeKey(null)).toBeNull();
  });

  it('maps every unsupported reason to a toolbar message', () => {
    const reasons = ['macos-too-old', 'linux-not-supported', 'platform-not-supported'] as const;
    const keys = reasons.map((reason) => getSystemAudioNoticeKey({ supported: false, reason }));

    expect(new Set(keys).size).toBe(reasons.length);
    for (const key of keys) {
      expect(key).not.toBeNull();
      expect(i18n.exists(`toolbar:${key}`)).toBe(true);
    }
  });
});

describe('recording reliability messages', () => {
  const LOCALES = ['de', 'en', 'es', 'fr', 'ja', 'ko', 'pt'];
  const KEYS = [
    'systemAudioUnsupported_macosTooOld',
    'systemAudioUnsupported_linux',
    'systemAudioUnsupported_platform',
    'recordingDisplayRemoved',
  ];

  it.each(LOCALES)('are translated in %s', (locale) => {
    const file = path.resolve(__dirname, `../../locales/${locale}/toolbar.json`);
    const strings = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    const english = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../locales/en/toolbar.json'), 'utf8'),
    ) as Record<string, string>;

    for (const key of KEYS) {
      expect(strings[key], `${locale}:${key}`).toEqual(expect.any(String));
      expect(strings[key].length).toBeGreaterThan(0);
      if (locale !== 'en') {
        expect(strings[key], `${locale}:${key} is untranslated`).not.toBe(english[key]);
      }
    }
  });
});
