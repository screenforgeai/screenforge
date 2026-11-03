export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '日本語' },
  { code: 'pt', label: 'Português' },
  { code: 'ko', label: '한국어' },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code) as string[];

export interface UserProfile {
  name: string;
  email: string;
}

export function detectBrowserLanguage(): string {
  if (typeof navigator === 'undefined') {
    return 'en';
  }
  const code = navigator.language.split('-')[0];
  return SUPPORTED_CODES.includes(code) ? code : 'en';
}
