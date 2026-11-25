// The editor moves the playhead with `timelineRef.setTime()` on every playback
// frame. The (patched) timeline library must redraw only its cursor for that,
// not every row and clip: re-rendering all clips each frame was most of the
// React work left during playback.
import { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Timeline } from '@xzdarcy/react-timeline-editor';
import type { TimelineRow, TimelineState } from '@xzdarcy/react-timeline-editor';

afterEach(() => {
  cleanup();
});

// jsdom has no layout; the library's virtualized grid sizes itself from these,
// and with zero size it would render no rows at all.
const sizeProps = ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight'] as const;
const originals = sizeProps.map((p) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, p));
beforeAll(() => {
  for (const p of sizeProps) {
    Object.defineProperty(HTMLElement.prototype, p, {
      configurable: true,
      get: () => (p.endsWith('Width') ? 800 : 300),
    });
  }
});
afterAll(() => {
  sizeProps.forEach((p, i) => {
    const original = originals[i];
    if (original) {
      Object.defineProperty(HTMLElement.prototype, p, original);
    }
  });
});

const ROWS: TimelineRow[] = [
  {
    id: 'video',
    actions: [
      { id: 'a', start: 0, end: 4, effectId: 'video' },
      { id: 'b', start: 4, end: 9, effectId: 'video' },
    ],
  },
  { id: 'zoom', actions: [{ id: 'z', start: 1, end: 3, effectId: 'zoom' }] },
];

describe('timeline cursor during playback', () => {
  it('moves the cursor without re-rendering clips', () => {
    let clipRenders = 0;
    const ref = createRef<TimelineState>();
    render(
      <div style={{ width: 800, height: 300 }}>
        <Timeline
          ref={ref}
          style={{ width: 800, height: 300 }}
          editorData={ROWS}
          effects={{ video: { id: 'video' }, zoom: { id: 'zoom' } }}
          getActionRender={(action) => {
            clipRenders += 1;
            return <div data-testid={`clip-${action.id}`} />;
          }}
          autoScroll={false}
        />
      </div>,
    );
    const before = clipRenders;
    expect(before).toBeGreaterThan(0);

    for (let i = 0; i < 30; i += 1) {
      act(() => {
        ref.current?.setTime(1 + i / 30);
      });
    }

    expect(ref.current?.getTime()).toBeCloseTo(1 + 29 / 30);
    expect(clipRenders - before).toBe(0);
  });

  it('still draws the cursor where the time is', () => {
    const ref = createRef<TimelineState>();
    const { container } = render(
      <Timeline
        ref={ref}
        style={{ width: 800, height: 300 }}
        editorData={ROWS}
        effects={{ video: { id: 'video' }, zoom: { id: 'zoom' } }}
        scale={1}
        scaleWidth={100}
        startLeft={20}
      />,
    );
    const cursor = () => container.querySelector<HTMLElement>('.timeline-editor-cursor');
    expect(cursor()).not.toBeNull();

    act(() => {
      ref.current?.setTime(3);
    });
    // left = startLeft + time / scale * scaleWidth - scrollLeft = 20 + 300.
    expect(cursor()?.style.left).toBe('320px');
  });
});
