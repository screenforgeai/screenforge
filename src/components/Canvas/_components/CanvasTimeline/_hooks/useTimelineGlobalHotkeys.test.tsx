import { act, cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from 'src/store';
import { useTimelineGlobalHotkeys } from './useTimelineGlobalHotkeys';

const callbacks = () => ({
  onTogglePlay: vi.fn(),
  onSplitAtPlayhead: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onDeleteSelected: vi.fn(),
  onSelectAll: vi.fn(),
  onClearSelection: vi.fn(),
  onAddZoom: vi.fn(),
  onAddCinematicZoom: vi.fn(),
  onAddText: vi.fn(),
  onAddMask: vi.fn(),
});

type Callbacks = ReturnType<typeof callbacks>;

const Harness = ({ cbs }: { cbs: Callbacks }): null => {
  useTimelineGlobalHotkeys(cbs);
  return null;
};

afterEach(() => {
  cleanup();
  act(() => useStore.getState().closeScreenshotEditor());
});

describe('useTimelineGlobalHotkeys', () => {
  it('handles timeline shortcuts in the editor', async () => {
    const user = userEvent.setup();
    const cbs = callbacks();
    render(<Harness cbs={cbs} />);
    await user.keyboard('z');
    await user.keyboard('{Delete}');
    expect(cbs.onAddZoom).toHaveBeenCalledTimes(1);
    expect(cbs.onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while the Screenshot editor is open', async () => {
    const user = userEvent.setup();
    const cbs = callbacks();
    render(<Harness cbs={cbs} />);
    act(() =>
      useStore.getState().openScreenshotEditor({
        kind: 'display',
        imageUrl: 'data:image/png;base64,x',
        width: 1,
        height: 1,
      }),
    );
    await user.keyboard('z');
    await user.keyboard('{Delete}');
    await user.keyboard(' ');
    await user.keyboard('{Meta>}z{/Meta}');
    expect(cbs.onAddZoom).not.toHaveBeenCalled();
    expect(cbs.onDeleteSelected).not.toHaveBeenCalled();
    expect(cbs.onTogglePlay).not.toHaveBeenCalled();
    expect(cbs.onUndo).not.toHaveBeenCalled();
  });

  it('lets the Screenshot editor see the keys it stays quiet for', async () => {
    const user = userEvent.setup();
    const cbs = callbacks();
    render(<Harness cbs={cbs} />);
    act(() =>
      useStore.getState().openScreenshotEditor({
        kind: 'display',
        imageUrl: 'data:image/png;base64,x',
        width: 1,
        height: 1,
      }),
    );
    // Registered after the timeline's listeners, like the editor's own hotkeys.
    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.key);
    document.addEventListener('keydown', listener);
    try {
      await user.keyboard('{Control>}z{/Control}');
      await user.keyboard('{Delete}');
      await user.keyboard('t');
    } finally {
      document.removeEventListener('keydown', listener);
    }
    expect(seen).toEqual(expect.arrayContaining(['z', 'Delete', 't']));
  });
});
