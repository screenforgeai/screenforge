// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { redactUserPaths, redactUserPathsDeep } from './redact-paths';

describe('redactUserPaths', () => {
  it('replaces the home folder with ~', () => {
    expect(redactUserPaths('ENOENT: /srv/me/Movies/a.mp4', '/srv/me')).toBe(
      'ENOENT: ~/Movies/a.mp4',
    );
  });

  it('drops the user name from macOS, Linux and Windows profile paths', () => {
    expect(redactUserPaths("open '/Users/jane/Movies/a.mp4' failed")).toBe(
      "open '~/Movies/a.mp4' failed",
    );
    expect(redactUserPaths('at /home/jane.doe/.config/x')).toBe('at ~/.config/x');
    expect(redactUserPaths('C:\\Users\\Jane Doe\\Videos\\a.mp4')).toBe('~\\Videos\\a.mp4');
    expect(redactUserPaths('file:///Users/jane/a.mp4')).toBe('file://~/a.mp4');
  });

  it('leaves URLs and other text alone', () => {
    expect(redactUserPaths('see https://example.com/home/docs')).toBe(
      'see https://example.com/home/docs',
    );
    expect(redactUserPaths('Nothing was captured.')).toBe('Nothing was captured.');
  });
});

describe('redactUserPathsDeep', () => {
  it('redacts strings inside objects and arrays, keeping other values', () => {
    expect(
      redactUserPathsDeep({
        error: '/Users/jane/a.mp4',
        nested: { paths: ['/home/jane/b.mp4'] },
        elapsed: 12,
        ok: true,
        none: null,
      }),
    ).toEqual({
      error: '~/a.mp4',
      nested: { paths: ['~/b.mp4'] },
      elapsed: 12,
      ok: true,
      none: null,
    });
  });
});
