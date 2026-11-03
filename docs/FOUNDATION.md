# Screenforge Foundation

Last updated: 2026-03-13

This document is the working baseline for implementing features safely and consistently in this repo.

## 1) What this project is

Screenforge is an Electron desktop app for screen recording and post-processing with cursor/zoom/background effects. The current implementation includes:

- Multi-window app shell (splash, floating toolbar, main editor)
- Screen capture via FFmpeg in main process
- Mouse event capture via `uiohook-napi`
- Optional mic capture via renderer `MediaRecorder` and FFmpeg merge
- Timeline/editor UI and effect-based canvas renderer
- Local project library persistence in `app.getPath('userData')/projects`

## 2) High-level architecture

- Main process: window lifecycle, IPC handlers, capture/merge/persistence services
- Preload: exposes a typed `window.screenforge` bridge
- Renderer: React app (toolbar + editor UI + timeline + canvas preview)
- Effects pipeline: pluggable `effectRegistry` with analyze/load/wrapper/layer phases

Core entrypoints:

- `electron/main.ts`
- `electron/preload.ts`
- `src/main.tsx`
- `src/app.tsx`

## 3) Main process module map

- `electron/modules/app/*`
  - App preload tasks and window commands (`showMain`, `showToolbar`, `quit`)
- `electron/modules/sources/*`
  - Desktop/window source enumeration via `desktopCapturer`
- `electron/modules/recording/*`
  - FFmpeg screen capture lifecycle, pause/resume, mic audio save + merge IPC
- `electron/modules/library/*`
  - Save/get/delete projects as JSON files
- `electron/modules/ffmpeg/*`
  - Binary resolution + FFmpeg runners/jobs

Shared IPC constants are in `electron/channels.ts`.

## 4) Renderer module map

- `src/components/FloatingToolbar.tsx`
  - Capture source selection + recording controls + optional mic capture
- `src/components/TopNav/TopNav.tsx`
  - Save/export controls and project naming
- `src/components/Canvas/*`
  - Video preview + timeline editor
- `src/hooks/useCanvasRenderer.ts`
  - RAF render loop + effect orchestration
- `src/store/index.ts`
  - Global Zustand state for recording/project/effect settings
- `src/lib/effects/*`
  - `zoom`, `cursor`, `background` effects and registry composition

## 5) End-to-end recording flow

1. Toolbar asks main process to start recording with selected source.
2. Main process starts FFmpeg capture and waits for readiness signal.
3. Main process starts global mouse tracking and records timestamps.
4. If mic is enabled, renderer starts `MediaRecorder`.
5. On stop, renderer signals processing state and stops mic + FFmpeg concurrently.
6. Main returns `filePath`, mouse data, `startTime`, and `recordingArea`.
7. If mic exists, renderer requests main to merge audio/video with FFmpeg.
8. Renderer sends final `recordingFinished` payload to main.
9. Main shows editor window and emits `recording:load`.

## 6) Core data contracts

Important shared types are in `src/types/index.ts`:

- `RecordingResult`
  - `filePath`, `mouseData`, `duration`, `startTime`, `recordingArea`, optional `audioPath`
- `SavedProject`
  - `id`, `name`, `result`, `zoomClips`, optional `background`, `savedAt`, `thumbnail`
- `ScreenforgeAPI`
  - Full renderer-facing preload bridge surface

Timeline types live in `src/types/timeline.ts`.

## 7) State model (Zustand)

`src/store/index.ts` stores:

- Current recording and processing state
- Current project ID/name + saved projects
- Zoom clip editing state and playhead
- Cursor and background settings
- Active widget tab

When loading a new recording, app-level effects reset key editor state (`zoomClips`, current time, selected clip, etc.).

## 8) Effects pipeline model

`src/lib/effects/registry.ts` order matters:

- `zoomEffect` (outer wrapper)
- `backgroundEffect`
- `cursorEffect`

Pipeline in `useCanvasRenderer`:

- `analyze(recording)` once on recording load
- Optional `onLoad(analyzed)` side effects
- Build `createFrameWrapper(...)` middleware chain
- Draw video + content layers inside wrappers
- Draw overlay layers last

## 9) Persistence and file locations

- Project JSON files: `app.getPath('userData')/projects/*.json`
- Temporary capture/merge outputs: `app.getPath('temp')`
- Custom media protocol for local playback: `screenforge://local/<absolute-path>`

## 10) Current known constraints

- Dirty working tree may contain in-progress local changes; do not revert unrelated files.
- Pause/resume behavior differs by platform (Linux path is more complete).
- Temporary media cleanup is not yet centralized.
- README roadmap/status can lag actual implementation state.

## 11) Development commands

- `pnpm start` - run Electron + renderer in dev mode
- `pnpm lint` - lint TypeScript/TSX
- `pnpm format` / `pnpm format:check` - prettier
- `pnpm make` - package distributables

## 12) Implementation guardrails for future tasks

- Always update shared types + IPC bridge + handler together for new capabilities.
- Prefer additive, localized changes inside the existing module boundaries.
- Keep channel names centralized in `electron/channels.ts`.
- Validate main/renderer parity for any API change.
- Run lint after meaningful edits.
- If touching recording flow, verify:
  - start/stop path
  - window transition behavior
  - resulting `RecordingResult` integrity
  - save/load project behavior

## 13) Working agreement for Codex in this repo

For feature work, follow this sequence unless directed otherwise:

1. Read affected module(s) + relevant types/channels first.
2. Implement minimal cohesive change across main/preload/renderer.
3. Run lint (and focused runtime verification where possible).
4. Report exact file changes and remaining risks.

When uncertainty exists, prioritize preserving current behavior and adding clear TODOs over broad refactors.

## 14) Feature Intake Template

Use this template before implementation starts.

```md
# Feature Intake: <feature name>

## 1. Objective
- Problem to solve:
- User value:
- Non-goals:

## 2. Scope
- In scope:
- Out of scope:
- Target platforms: Linux / macOS / Windows

## 3. UX/Behavior
- Entry points (screens/components):
- Primary user flow:
- Edge/error states:
- Accessibility expectations:

## 4. Technical Design
- Affected modules/files:
- New/changed types:
- New/changed IPC channels:
- Data model/storage impact:
- FFmpeg/media pipeline impact (if any):

## 5. Compatibility + Risks
- Backward compatibility expectations:
- Migration needed? (yes/no):
- Known risks:
- Rollback plan:

## 6. Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## 7. Validation Plan
- Lint/type checks:
- Manual test matrix (platforms + scenarios):
- Regression checks:

## 8. Delivery
- Estimated change size (S/M/L):
- Proposed implementation order:
- Follow-up tasks (optional):
```

### Intake Quality Gate

Do not start coding until these are explicit:

- Objective and non-goals are clear.
- Scope includes platform expectations.
- Affected modules and IPC/type changes are identified.
- Acceptance criteria are testable.
- Validation plan covers at least one regression path.
