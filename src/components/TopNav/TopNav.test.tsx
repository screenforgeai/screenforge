import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdaterState } from 'src/types';
import { TopNav } from './TopNav';

let updaterState: UpdaterState | null = null;
let recordingResult: { filePath: string } | null = { filePath: '/tmp/recording.mp4' };
let isSaving = true;
let isTitleRequired = false;
let checkForUpdatesNow: ReturnType<typeof vi.fn>;

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../hooks/useUpdaterState', () => ({
  useUpdaterState: () => updaterState,
}));

vi.mock('../../hooks/useVideoExport', () => ({
  useVideoExport: () => ({
    state: { status: 'idle', progress: 0, error: null, warnings: [] },
    runExport: vi.fn(),
    cancelExport: vi.fn(),
    reset: vi.fn(),
    isExporting: false,
  }),
}));

vi.mock('../../store', () => ({
  useStore: (
    selector: (state: {
      recordingResult: { filePath: string } | null;
      recordingName: string;
      currentProjectId: string;
      savedProjects: never[];
      frame: { aspectRatioId: string };
      mediaSegments: never[];
      commitEdit: ReturnType<typeof vi.fn>;
      requestPauseAndSeekTo: ReturnType<typeof vi.fn>;
    }) => unknown,
  ) =>
    selector({
      recordingResult,
      recordingName: 'Untitled recording',
      currentProjectId: 'project-1',
      savedProjects: [],
      frame: { aspectRatioId: 'original' },
      mediaSegments: [],
      commitEdit: vi.fn(),
      requestPauseAndSeekTo: vi.fn(),
    }),
}));

vi.mock('../ProjectPersistenceProvider', () => ({
  useProjectPersistence: () => ({
    closeTitleEditor: vi.fn(),
    flushPendingSave: vi.fn().mockResolvedValue(true),
    isSaving,
    isTitleRequired,
    openTitleEditor: vi.fn(),
    submitTitle: vi.fn().mockResolvedValue(true),
    titlePopoverOpen: false,
  }),
}));

vi.mock('../ExportModal', () => ({
  default: () => null,
}));

beforeEach(() => {
  updaterState = null;
  recordingResult = { filePath: '/tmp/recording.mp4' };
  isSaving = true;
  isTitleRequired = false;
  checkForUpdatesNow = vi.fn();

  Object.defineProperty(window, 'screenforge', {
    value: {
      checkForUpdatesNow,
      restartToApplyUpdate: vi.fn().mockResolvedValue(undefined),
      revealExportInFolder: vi.fn().mockResolvedValue(undefined),
      getPresets: vi.fn().mockResolvedValue([]),
      getShareState: vi.fn().mockResolvedValue({ status: 'idle' }),
      onShareStateChanged: vi.fn(() => vi.fn()),
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  updaterState = null;
  vi.clearAllMocks();
});

describe('TopNav updater activity', () => {
  it('keeps autosaving visible during scheduled background checks', () => {
    updaterState = { currentVersion: '0.2.0', status: 'checking' };

    render(<TopNav onOpenFFmpegSetup={vi.fn()} />);

    expect(screen.getByText('Autosaving...')).toBeInTheDocument();
    expect(screen.queryByText('Checking for updates...')).not.toBeInTheDocument();
  });

  it('shows checking activity only for a manual retry check', async () => {
    let resolveCheck: ((state: UpdaterState) => void) | null = null;
    checkForUpdatesNow.mockReturnValue(
      new Promise<UpdaterState>((resolve) => {
        resolveCheck = resolve;
      }),
    );
    updaterState = {
      currentVersion: '0.2.0',
      status: 'error',
      errorMessage: 'feed unavailable',
    };

    render(<TopNav onOpenFFmpegSetup={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /retry update/i }));

    expect(screen.getByText('Checking for updates...')).toBeInTheDocument();
    expect(screen.getByText('Autosaving...')).toBeInTheDocument();

    resolveCheck?.({ currentVersion: '0.2.0', status: 'idle' });
    await waitFor(() => {
      expect(screen.queryByText('Checking for updates...')).not.toBeInTheDocument();
    });
  });

  it('shows download activity without hiding autosaving', () => {
    updaterState = { currentVersion: '0.2.0', status: 'downloading' };

    render(<TopNav onOpenFFmpegSetup={vi.fn()} />);

    expect(screen.getByText('Downloading update...')).toBeInTheDocument();
    expect(screen.getByText('Autosaving...')).toBeInTheDocument();
  });

  it('shows ready updates even when no recording is loaded', () => {
    recordingResult = null;
    updaterState = {
      currentVersion: '0.2.0',
      status: 'ready',
      availableVersion: '0.2.1',
    };

    render(<TopNav onOpenFFmpegSetup={vi.fn()} />);

    expect(screen.getByText(/restart when you.re done here/i)).toBeInTheDocument();
    expect(screen.queryByText('Autosaving...')).not.toBeInTheDocument();
  });

  it('shows a passive downloaded state while waiting for the app to become idle', () => {
    updaterState = {
      currentVersion: '0.2.0',
      status: 'downloaded',
      availableVersion: '0.2.1',
    };

    render(<TopNav onOpenFFmpegSetup={vi.fn()} />);

    expect(screen.getByRole('button', { name: /update downloaded/i })).toBeDisabled();
  });
});
