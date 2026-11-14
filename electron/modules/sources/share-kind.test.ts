import { describe, expect, it } from 'vitest';
import { setShareKind, takeShareKind } from './share-kind';

describe('share kind', () => {
  it('asks for a screen unless the toolbar asked for a window', () => {
    expect(takeShareKind()).toBe('screen');
  });

  it('asks for a window once, then for a screen again', () => {
    setShareKind('window');
    expect(takeShareKind()).toBe('window');
    expect(takeShareKind()).toBe('screen');
  });

  it('treats anything unexpected as a screen', () => {
    setShareKind('tab' as never);
    expect(takeShareKind()).toBe('screen');
  });
});
