# Timeline Indicators

Read-only metadata markers that appear in the **Markers** row above the Video track. Each indicator is a small coloured pill rendered via an absolute-positioned overlay — not as a library clip — so the row has a clean, consistent look with no resize handles.

## Architecture

```
TimelineIndicatorKind (src/types/timeline.ts)
    ↑ defined by each feature

IndicatorClip.tsx          — absolutely-positioned pill; takes x, width, label, kind
CanvasTimeline.tsx         — overlay JSX + scrollLeft/scrollTop sync
constants.ts               — 'indicators' layer (no effect entry needed)
```

### Overlay approach

The library row for `'indicators'` receives `actions: []` — it is rendered by the library only to produce the correct row height and gutter label. The actual pills are drawn in a `pointer-events-none` overlay `div` stacked above the `<Timeline>` component.

Each pill is positioned with:

```
x = TIMELINE_START_LEFT + (combo.start / SCALE) * scaleWidth - scrollLeft
```

Vertical position tracks the row:

```
rowTop = RULER_H + sortedLayers.indexOf(indicatorsLayer) * LANE_H - scrollTop
```

`scrollLeft` and `scrollTop` are React state kept in sync with `onScroll` callbacks so the overlay repaints on scroll.

The row is **hidden automatically** when there are no indicators to show (e.g. recordings without keyboard data). Hiding via the eye icon also suppresses the overlay.

## Adding a new indicator type

### 1. Add a kind to `TimelineIndicatorKind`

```ts
// src/types/timeline.ts
export type TimelineIndicatorKind =
  | 'keyboard-shortcut'
  | 'mouse-click';        // ← add yours here
```

### 2. Add a style entry to `IndicatorClip`

```ts
// IndicatorClip.tsx
const KIND_STYLES: Record<TimelineIndicatorKind, ...> = {
  'keyboard-shortcut': { ... },
  'mouse-click': {
    bg: 'rgba(6, 182, 212, 0.18)',
    border: 'rgba(34, 211, 238, 0.5)',
    text: 'rgba(165, 243, 252, 0.95)',
    dot: 'rgba(103, 232, 249, 0.9)',
  },
};
```

### 3. Compute events and add to the overlay in `CanvasTimeline`

Add a `useMemo` that converts your feature's events into objects with `{ id, start, end, keys[] }`, then merge them into the overlay render inside the indicators IIFE:

```tsx
// Inside the overlay IIFE, alongside keyboardTimelineData.comboEvents.map(...)
...mouseClickEvents.map((ev) => {
  const x = TIMELINE_START_LEFT + (ev.start / SCALE) * scaleWidth - scrollLeft;
  const rawW = ((ev.end - ev.start) / SCALE) * scaleWidth;
  return (
    <IndicatorClip key={ev.id} label="Click" kind="mouse-click" x={x} width={rawW} />
  );
})
```

Update the `sortedLayers` filter to also check `mouseClickEvents.length > 0` so the row appears when only mouse-click data is present.

## Future directions

| Idea | Data source | Notes |
|---|---|---|
| Mouse clicks | `mousedown` events in `recordingResult.mouseData` | Already available |
| Silence / dead air | Audio amplitude scan (FFmpeg loudness filter) | Needs new analysis step |
| Cursor idle zones | No `move` events for >2 s | Derivable from existing data |
| Cut suggestions | Silence + no activity combined | Actionable variant — pill gets a scissors affordance on hover |

Cut suggestions are the same overlay layer but with `kind: 'cut-suggestion'`. Clicking one (requires `pointer-events-auto` on the pill) calls `splitAtTime(indicator.start)` and `splitAtTime(indicator.end)` to trim the dead section automatically.
