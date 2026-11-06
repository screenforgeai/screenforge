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
        dataUrl: 'data:image/png;base64,x',
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
});
