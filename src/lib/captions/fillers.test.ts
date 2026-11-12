import { describe, expect, it } from 'vitest';
import { FILLER_PATTERNS, isFillerWord, normalizeTranscriptWord } from './fillers';

describe('normalizeTranscriptWord', () => {
  it('lowercases and strips surrounding punctuation', () => {
    expect(normalizeTranscriptWord('Um,')).toBe('um');
    expect(normalizeTranscriptWord('"Uh..."')).toBe('uh');
    expect(normalizeTranscriptWord('—erm—')).toBe('erm');
  });

  it('keeps the Japanese long-vowel mark, which is a letter, not punctuation', () => {
    expect(normalizeTranscriptWord('えー、')).toBe('えー');
  });
});

describe('isFillerWord', () => {
  it('finds common English hesitations, however they are spelled', () => {
    for (const word of ['um', 'Um,', 'umm', 'uh', 'uhh...', 'uhm', 'er', 'erm', 'hmm', 'Hmm?']) {
      expect(isFillerWord(word, 'en'), word).toBe(true);
    }
  });

  it('leaves real English words alone', () => {
    for (const word of ['umbrella', 'under', 'her', 'ah-ha', 'like', 'so', 'mother', 'a', 'I']) {
      expect(isFillerWord(word, 'en'), word).toBe(false);
    }
  });

  it('knows the fillers of every app language', () => {
    expect(isFillerWord('ähm', 'de')).toBe(true);
    expect(isFillerWord('äh,', 'de')).toBe(true);
    expect(isFillerWord('eh', 'es')).toBe(true);
    expect(isFillerWord('ehm', 'es')).toBe(true);
    expect(isFillerWord('euh', 'fr')).toBe(true);
    expect(isFillerWord('heu', 'fr')).toBe(true);
    expect(isFillerWord('hum', 'pt')).toBe(true);
    expect(isFillerWord('ãh', 'pt')).toBe(true);
    expect(isFillerWord('えーと', 'ja')).toBe(true);
    expect(isFillerWord('えっと、', 'ja')).toBe(true);
    expect(isFillerWord('あのー', 'ja')).toBe(true);
    expect(isFillerWord('うーん', 'ja')).toBe(true);
    expect(isFillerWord('음', 'ko')).toBe(true);
    expect(isFillerWord('어...', 'ko')).toBe(true);
  });

  it('does not borrow another language’s fillers when they are real words there', () => {
    // German "er" is "he"; Portuguese "um" is "a/one"; Japanese "ええ" is "yes".
    expect(isFillerWord('er', 'de')).toBe(false);
    expect(isFillerWord('um', 'pt')).toBe(false);
    expect(isFillerWord('ええ', 'ja')).toBe(false);
    expect(isFillerWord('うん', 'ja')).toBe(false);
  });

  it('reads region tags and falls back to English for languages it has no list for', () => {
    expect(isFillerWord('ähm', 'de-AT')).toBe(true);
    expect(isFillerWord('um', 'en-GB')).toBe(true);
    expect(isFillerWord('um', 'nl')).toBe(true);
    expect(isFillerWord('um', '')).toBe(true);
  });

  it('has a list for each of the seven app languages', () => {
    expect(Object.keys(FILLER_PATTERNS).sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'ko', 'pt']);
  });
});
