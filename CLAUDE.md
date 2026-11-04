# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm start              # Start in dev mode (Electron Forge + Vite HMR)
pnpm lint               # ESLint check
pnpm format             # Prettier write (src/**/*.{ts,tsx} and electron/**/*.ts)
pnpm format:check       # Check formatting without writing
pnpm test:unit          # Vitest unit tests
pnpm test:export        # Export-specific tests (vitest.export.config.ts)
pnpm test:all           # Both test suites
pnpm test:unit:watch    # Vitest watch mode
pnpm make               # Build distributable installers
pnpm package            # Package the app
```

Always run `pnpm lint` and `pnpm format` after writing code.

## Architecture

Screenforge is an Electron desktop app for screen recording with automatic zoom/cursor tracking. Video processing runs through a bundled FFmpeg.

### Process Split

**Main process** (`electron/`): Screen capture, FFmpeg orchestration, file I/O, IPC handling.

**Renderer** (`src/`): React 19 UI, Zustand state, canvas preview, timeline editor.

**Bridge**: `electron/preload.ts` exposes `window.screenforge` API via context bridge. `sandbox: false` is intentional — required for `uiohook-napi` and the native macOS capture binary. All IPC channel names are centralized in `electron/channels.ts`.

### Module Pattern (Main Process)

Each feature under `electron/modules/` follows the same three-file pattern:
- `channel.ts` — registers IPC handlers via `handleChannel`, `handleChannelWithSender`, `listenChannel`
- `service.ts` — business logic only, no IPC knowledge
- `bridge.ts` — preload-side API using `createInvokeBridge`, `createSendBridge`, `createSubscription`

These are composed into `window.screenforge` inside `electron/preload.ts` via `contextBridge.exposeInMainWorld`. Always add new channels to `electron/channels.ts` rather than hardcoding strings.

### State Management

Single Zustand store at `src/store/index.ts`. Every mutation that should be undoable calls `commitEdit(label, mutator)`. History is stored as deep-cloned snapshots (not JSON), capped at 100 entries. Multiple related edits can be grouped with `beginHistoryGroup(key, label)` / `endHistoryGroup(key)` — use the same key for continuations (e.g. slider drag).

The editable slices (undo-tracked): `zoomClips`, `mediaSegments`, cursor settings, camera settings, keyboard settings, frame settings.

Non-editable UI state (`currentTime`, `selectedClip`, `activeWidget`, `focusMode`, etc.) is mutated directly without `commitEdit`.

Always use `useShallow` from `zustand/react/shallow` when selecting multiple values to avoid unnecessary re-renders.

The store state is serialized for project persistence — never store non-serializable values (functions, DOM nodes, class instances).

### Project Persistence

`src/components/ProjectPersistenceProvider.tsx` manages autosave (15s debounce), new-project title requirement, unsaved-change detection, and in-flight save deduplication. It communicates via `library:save` / `library:get-all` IPC channels.

Key context values: `isSaving`, `hasUnsavedChanges`, `isTitleRequired`, `flushPendingSave()`, `discardPendingSave()`, `setLoadedProject()`, `openTitleEditor()`.

When switching or deleting projects, always call `flushPendingSave()` first and check the return value — it returns `false` if the save failed or was cancelled.

### Data Flow

1. **Record**: Main process captures screen + mouse events → IPC → renderer loads into store via `loadRecordingSession()`
2. **Edit**: Zustand mutations → React re-renders canvas/timeline preview
3. **Save**: Store state → `ProjectPersistenceProvider` → `library:save` IPC → disk
4. **Export**: `export:start` IPC → Main spawns hidden `BrowserWindow` (export worker at `#export-worker` hash) → hidden window runs Pixi render pipeline frame-by-frame → encoded chunks sent back → FFmpeg muxes video + audio → file written to disk

### Effects Architecture

Two rendering pipelines exist in parallel — choose the right one:

- **Canvas 2D** (`src/lib/effects/*/render.ts`) — live preview only, runs in the renderer via `usePixiRenderer`
- **Pixi.js** (`src/lib/effects/*/pixi.ts`) — frame-accurate export rendering in the hidden worker window

Effects are registered in order in `effectRegistry[]` (Canvas 2D) and `pixiEffectRegistry[]` (Pixi). Render order matters: zoom → frame → cursor → camera → keyboard. Zoom wraps everything; cursor is not affected by zoom transforms.

Each effect subdirectory (`cursor/`, `frame/`, `zoom/`, `camera/`, `keyboard/`) contains its own analysis, rendering, and sometimes audio logic. Keep these self-contained.

### Canvas / Timeline

`src/components/Canvas/Canvas.tsx` hosts both `CanvasPreview` and `CanvasTimeline`.

`CanvasTimeline` uses `@xzdarcy/react-timeline-editor`. The indicators layer (mouse clicks, keyboard shortcuts) is rendered as an absolutely-positioned overlay (`z-index: 2`) rather than as timeline actions, because the library doesn't support custom rendering for that lane. The playhead cursor CSS is overridden in `src/index.css` under `.sf-timeline-wrapper` to ensure it renders above the indicators overlay.

Helpers for segment manipulation live in `src/lib/helpers/segments.ts` — always use these rather than mutating `mediaSegments` directly.

### UI Library and Icons

Components live in `src/lib/ui/`. Import from `src/lib/ui` (the index re-export), not from internal paths, except for `Button as ButtonWrapper` from `src/lib/ui/components/primitives/button` when you need `asChild`/`hoverScale`/`tapScale` props.

All icons are created via the `createIcon(hugeiconsIcon, displayName)` wrapper in `src/lib/icons.tsx`, sourced from `@hugeicons/core-free-icons`. To add a new icon: import the `*Icon` export from `@hugeicons/core-free-icons`, then add `export const IconFoo = createIcon(FooIcon, 'IconFoo')`. Props: `size` (default 24), `stroke` (strokeWidth, default 1.5), `color`.

### Styling

Tailwind v4 (`@import "tailwindcss"` in `index.css`). Do not use v3 syntax.

Use `sf-*` color tokens for all UI — these are CSS custom properties defined in `:root`:
- `sf-bg`, `sf-panel`, `sf-border`, `sf-border-lt` — backgrounds and borders
- `sf-primary`, `sf-secondary`, `sf-muted` — text hierarchy
- `sf-red`, `sf-green` — status colors

The primary accent color is `var(--primary)` (orange-red `#d44523`). Use `var(--primary)` or `text-primary`/`bg-primary` Tailwind classes. Avoid inventing new color values — map to existing tokens.

For nested rounded elements use `visual-concentric-radius`: inner radius = outer radius minus padding.

### ESLint Notes

- Arrow function components are enforced (`const Foo = () => ...`, not `function Foo()`)
- `src/lib/**` files are exempt from strict React/hooks rules (mutations allowed for effect rendering)
- Import resolution uses TypeScript path alias `src/*` → `src/*`

### Key Files

| File | Purpose |
|------|---------|
| `src/store/index.ts` | All editor state + undo/redo |
| `src/store/types.ts` | AppStore interface, HistorySnapshot, EditableStorePatch |
| `src/app.tsx` | App shell + global IPC event listeners |
| `electron/main.ts` | Window creation, module registration |
| `electron/channels.ts` | IPC channel name constants |
| `electron/preload.ts` | contextBridge — exposes window.screenforge |
| `electron/lib/ipc-main.ts` | handleChannel, listenChannel helpers |
| `electron/lib/ipc-renderer.ts` | createInvokeBridge, createSendBridge, createSubscription |
| `src/components/ProjectPersistenceProvider.tsx` | Save/autosave lifecycle |
| `src/components/Canvas/Canvas.tsx` | Video preview + timeline editor |
| `src/lib/effects/` | Cursor, frame, zoom, camera, keyboard rendering |
| `src/lib/helpers/segments.ts` | Media segment manipulation helpers |
| `electron/modules/recording/` | Screen capture, mouse tracking (uiohook-napi) |
| `electron/modules/export/` | FFmpeg job orchestration, hidden export window |
