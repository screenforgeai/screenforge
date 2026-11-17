import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isModalOpen, markModalOpen, useModalActivity } from './use-modal-activity';

describe('modal activity', () => {
  it('counts overlapping modals and releases each one once', () => {
    expect(isModalOpen()).toBe(false);
    const releaseA = markModalOpen();
    const releaseB = markModalOpen();
    releaseA();
    releaseA();
    expect(isModalOpen()).toBe(true);
    releaseB();
    expect(isModalOpen()).toBe(false);
  });

  it('follows a dialog open state, including unmounting while open', () => {
    const { rerender, unmount } = renderHook(({ open }) => useModalActivity(open), {
      initialProps: { open: false },
    });
    expect(isModalOpen()).toBe(false);
    rerender({ open: true });
    expect(isModalOpen()).toBe(true);
    rerender({ open: false });
    expect(isModalOpen()).toBe(false);
    rerender({ open: true });
    unmount();
    expect(isModalOpen()).toBe(false);
  });
});
