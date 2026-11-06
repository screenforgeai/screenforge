/**
 * Filler words ("um", "uh") per transcript language, for "remove filler words".
 *
 * Only non-lexical hesitation sounds are listed — never words that also carry
 * meaning ("like", "so", Spanish "este", Japanese "ええ" = yes) — so a match is
 * safe to cut. Lists are per language because one language's filler is another's
 * word: German "er" is "he", Portuguese "um" is "a/one".
 *
 * To add a language, add an entry keyed by its ISO 639-1 code. Patterns match a
 * whole word after `normalizeTranscriptWord`, and use `+` so stretched spellings
 * ("ummm", "uhhh") match too.
 */
export type FillerLanguage = 'en' | 'de' | 'es' | 'fr' | 'pt' | 'ja' | 'ko';

export const FILLER_PATTERNS: Record<FillerLanguage, RegExp[]> = {
  en: [/^u+[hm]+$/, /^e+r+m*$/, /^h+m+$/],
  de: [/^ä+h*m+$/, /^ä+h+m*$/, /^ö+h+m*$/, /^h+m+$/],
  es: [/^e+h+m*$/, /^e+m+$/, /^m{2,}$/, /^h+m+$/],
  fr: [/^e+u+h+m*$/, /^h+e+u+h*$/, /^h+u+m+$/, /^h+m+$/],
  pt: [/^h+u+m+$/, /^h+ã+$/, /^ã+h+$/, /^é+h+$/, /^h+m+$/],
  ja: [/^え(ー+|ー*っ?と)$/, /^え+っと$/, /^あ(のー+|のう|ー+)$/, /^うー+ん$/, /^んー+$/],
  ko: [/^으*음+$/, /^어+$/, /^흠+$/, /^에+$/],
};

const FALLBACK_LANGUAGE: FillerLanguage = 'en';

const EDGE_PUNCTUATION = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu;

/** Lowercases a transcript word and strips the punctuation Whisper attaches to it. */
export function normalizeTranscriptWord(word: string): string {
  return word.normalize('NFC').toLowerCase().replace(EDGE_PUNCTUATION, '');
}

function resolveLanguage(language: string): FillerLanguage {
  const base = language.trim().toLowerCase().split(/[-_]/)[0];
  return base in FILLER_PATTERNS ? (base as FillerLanguage) : FALLBACK_LANGUAGE;
}

/**
 * True when `word` is a filler in `language` (a code such as "en" or "de-AT").
 * Languages without a list use English.
 */
export function isFillerWord(word: string, language: string): boolean {
  const normalized = normalizeTranscriptWord(word);
  if (!normalized) {
    return false;
  }
  return FILLER_PATTERNS[resolveLanguage(language)].some((pattern) => pattern.test(normalized));
}
