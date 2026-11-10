import { describe, expect, it } from 'vitest';
import { CHANGELOG_URL, SITE_URL } from './siteLinks';

describe('site links', () => {
  it('point at screenforge.co, not the old screenforgeai.com', () => {
    expect(SITE_URL).toBe('https://screenforge.co');
    expect(CHANGELOG_URL).toBe('https://screenforge.co/changelog');
  });
});
