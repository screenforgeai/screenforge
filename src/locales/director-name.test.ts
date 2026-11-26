import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The cloud app is always "Screenforge Director" in this app: "Director" on
// its own doesn't say what it is.
const LOCALES_DIR = __dirname;
const NAMESPACES = ['settings', 'export', 'recordings', 'common', 'onboarding'];
const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const strings = (locale: string, namespace: string): Record<string, string> =>
  JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, `${namespace}.json`), 'utf8'));

describe('the Screenforge Director name', () => {
  it('covers all 7 locales', () => {
    expect(locales.sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'ko', 'pt']);
  });

  for (const locale of locales) {
    it(`${locale}: never says "Director" on its own`, () => {
      const bare: string[] = [];
      for (const namespace of NAMESPACES) {
        for (const [key, value] of Object.entries(strings(locale, namespace))) {
          // German joins it into compounds: "Screenforge-Director-Konto".
          if (/(?<!Screenforge[ -])Director/.test(value)) {
            bare.push(`${namespace}.${key}: ${value}`);
          }
        }
      }
      expect(bare).toEqual([]);
    });

    it(`${locale}: keeps the Settings tab and sign-in button short`, () => {
      const settings = strings(locale, 'settings');
      expect(settings.tabs_director).not.toContain('Director');
      expect(settings.director_title).toBe(settings.tabs_director);
      expect(settings.director_signIn).not.toContain('Director');
    });

    it(`${locale}: explains what Screenforge Director is`, () => {
      const common = strings(locale, 'common');
      expect(common.directorInfo).toContain('Screenforge Director');
      expect(common.directorInfoLabel).toContain('Screenforge Director');
    });
  }
});
