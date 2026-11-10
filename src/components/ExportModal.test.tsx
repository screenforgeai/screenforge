import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExportModal from './ExportModal';

// ---------------------------------------------------------------------------
// Store mock — provide a fixed 60-second duration so size estimates work.
// ---------------------------------------------------------------------------
vi.mock('../store', () => ({
  useStore: (
    selector: (s: {
      recordingResult: { duration: number };
      mediaSegments: never[];
      captions: { captionsEnabled: boolean; segments: never[] };
    }) => unknown,
  ) =>
    selector({
      recordingResult: { duration: 60 },
      mediaSegments: [],
      captions: { captionsEnabled: false, segments: [] },
    }),
}));

// The share panel has its own tests; here we only check what it's given.
vi.mock('./Share/SharePanel', () => ({
  SharePanel: (props: Record<string, unknown>) => (
    <div data-testid="share-panel">{JSON.stringify(props)}</div>
  ),
}));

// ---------------------------------------------------------------------------
// window.screenforge mock
// ---------------------------------------------------------------------------
const mockSuggestExportPath = vi.fn();
const mockCheckFileExists = vi.fn();
const mockPickExportPath = vi.fn();
const mockCheckFFmpegStatus = vi.fn();
const mockRevealExportInFolder = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  // Default: suggest a valid path based on format, no existing file.
  mockSuggestExportPath.mockImplementation((_base: string, format: string) =>
    Promise.resolve(`/Users/test/output.${format}`),
  );
  mockCheckFileExists.mockResolvedValue(false);
  mockPickExportPath.mockResolvedValue(null);
  mockCheckFFmpegStatus.mockResolvedValue({ available: true });

  Object.defineProperty(window, 'screenforge', {
    value: {
      suggestExportPath: mockSuggestExportPath,
      checkFileExists: mockCheckFileExists,
      pickExportPath: mockPickExportPath,
      checkFFmpegStatus: mockCheckFFmpegStatus,
      revealExportInFolder: mockRevealExportInFolder,
    },
    writable: true,
    configurable: true,
  });
});

// Explicitly cleanup after every test so Radix portal nodes don't bleed
// between tests (jsdom auto-cleanup does not cover portal children reliably).
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------
const idleExportState = { status: 'idle' as const, progress: 0, error: null, warnings: [] };

function renderModal(onExport = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ExportModal
      open={true}
      recordingName="My Recording"
      exportState={idleExportState}
      onClose={vi.fn()}
      onCancelExport={vi.fn()}
      onExport={onExport}
      onOpenFFmpegSetup={vi.fn()}
    />,
  );
  return { onExport };
}

/** Wait for the suggested path to hydrate, then click the Export button. */
async function clickExport() {
  // The path is set asynchronously; wait until the export button is present.
  const btn = await screen.findByRole('button', { name: /^export$/i });
  await userEvent.click(btn);
}

/**
 * Open the Select whose label exactly matches `labelText`, then click the
 * option with text `optionText`.
 *
 * Uses the label's parent element to scope the trigger lookup so there is no
 * ambiguity even when multiple selects share a similar label.
 */
async function pickSelectOption(labelText: string | RegExp, optionText: string | RegExp) {
  const label = screen.getByText(labelText);
  const trigger = label.parentElement?.querySelector<HTMLElement>('button[role="combobox"]');
  if (!trigger) {
    throw new Error(`Could not find combobox trigger for label "${String(labelText)}"`);
  }
  await userEvent.click(trigger);
  const option = await screen.findByRole('option', { name: optionText });
  await userEvent.click(option);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExportModal — default settings reach onExport', () => {
  it('submits high quality, 1080p, 60fps, mp4 by default', async () => {
    const { onExport } = renderModal();
    await clickExport();

    expect(onExport).toHaveBeenCalledOnce();
    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({
      format: 'mp4',
      resolution: '1080p',
      fps: 60,
      quality: 'high',
      includeAudio: true,
      audioBitrateKbps: 320,
    });
  });
});

describe('ExportModal — quality setting', () => {
  it('submits high quality with correct audio bitrate (320 kbps)', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Quality', 'High');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ quality: 'high', audioBitrateKbps: 320 });
  });

  it('submits fast quality with correct audio bitrate (128 kbps)', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Quality', 'Fast');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ quality: 'fast', audioBitrateKbps: 128 });
  });

  it('submits balanced quality with correct audio bitrate (192 kbps)', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Quality', 'Balanced');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ quality: 'balanced', audioBitrateKbps: 192 });
  });
});

describe('ExportModal — resolution setting', () => {
  it('submits 720p when selected', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Resolution', '720p');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ resolution: '720p' });
  });

  it('submits 4K when selected', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Resolution', '4K');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ resolution: '4k' });
  });
});

describe('ExportModal — fps setting', () => {
  it('submits 24fps when selected', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('FPS', '24');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ fps: 24 });
  });

  it('submits 30fps when selected', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('FPS', '30');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ fps: 30 });
  });
});

describe('ExportModal — format setting', () => {
  it('submits mov format with audio enabled', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Format', 'MOV');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ format: 'mov', includeAudio: true });
  });

  it('submits webm format with audio enabled', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Format', 'WebM');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ format: 'webm', includeAudio: true });
  });

  it('submits gif with includeAudio: false', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Format', 'GIF');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).toMatchObject({ format: 'gif', includeAudio: false, fps: 25 });
  });

  it('hides the Quality selector for GIF', async () => {
    renderModal();
    expect(screen.getByText('Quality')).toBeInTheDocument();
    await pickSelectOption('Format', 'GIF');
    expect(screen.queryByText('Quality')).not.toBeInTheDocument();
  });

  it('normalizes the default 60fps video setting to a GIF-safe 25fps', async () => {
    renderModal();
    await pickSelectOption('Format', 'GIF');

    const fpsLabel = screen.getByText('FPS');
    const trigger = fpsLabel.parentElement?.querySelector<HTMLElement>('button[role="combobox"]');
    expect(trigger).toHaveTextContent('25');
  });

  it('shows only GIF-safe fps options after switching to GIF', async () => {
    renderModal();
    await pickSelectOption('Format', 'GIF');

    const fpsLabel = screen.getByText('FPS');
    const trigger = fpsLabel.parentElement?.querySelector<HTMLElement>('button[role="combobox"]');
    if (!trigger) {
      throw new Error('Could not find FPS combobox trigger');
    }

    await userEvent.click(trigger);
    expect(await screen.findByRole('option', { name: '20' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: '25' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '60' })).not.toBeInTheDocument();
  });
});

describe('ExportModal — removed preset field', () => {
  /**
   * `preset` (ExportPreset) was a vestigial field — it was never read by the
   * export pipeline after encoding moved to VideoEncoder. It has been removed
   * from ExportSettings. These tests confirm it no longer appears in the payload.
   */
  it('payload does not contain a preset field when High quality is selected', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Quality', 'High');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).not.toHaveProperty('preset');
  });

  it('payload does not contain a preset field when Fast quality is selected', async () => {
    const { onExport } = renderModal();
    await pickSelectOption('Quality', 'Fast');
    await clickExport();

    const [, settings] = onExport.mock.calls[0];
    expect(settings).not.toHaveProperty('preset');
  });
});

describe('ExportModal — validation', () => {
  it('does not call onExport when no output path is available', async () => {
    mockSuggestExportPath.mockResolvedValue('');
    const { onExport } = renderModal();

    // Wait for the async path hydration to settle.
    await waitFor(() => expect(mockSuggestExportPath).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));

    expect(onExport).not.toHaveBeenCalled();
    expect(screen.getByText(/select an output path/i)).toBeInTheDocument();
  });
});

describe('ExportModal — warnings', () => {
  it('renders export warnings from the export state', () => {
    render(
      <ExportModal
        open={true}
        recordingName="My Recording"
        exportState={{
          status: 'rendering',
          progress: 0.2,
          error: null,
          outputPath: null,
          resourceStats: null,
          warnings: ['This export may buffer about 800 MB in memory before finalization.'],
        }}
        onClose={vi.fn()}
        onCancelExport={vi.fn()}
        onExport={vi.fn().mockResolvedValue(undefined)}
        onOpenFFmpegSetup={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/buffer about 800 MB in memory before finalization/i),
    ).toBeInTheDocument();
  });
});

describe('ExportModal — estimated size', () => {
  it('shows a realistic video estimate instead of the encoder max-bitrate upper bound', () => {
    renderModal();
    expect(screen.getByText(/Estimated size:/i)).toHaveTextContent('~137 MB');
  });

  it('updates the estimate when switching to GIF', async () => {
    renderModal();
    await pickSelectOption('Format', 'GIF');
    expect(screen.getByText(/Estimated size:/i)).toHaveTextContent('~156 MB');
  });
});

describe('ExportModal — after a successful export', () => {
  const renderDone = (outputPath: string, onClose = vi.fn()) => {
    render(
      <ExportModal
        open={true}
        recordingName="My Recording"
        exportState={{
          status: 'success',
          progress: 1,
          error: null,
          outputPath,
          resourceStats: null,
          warnings: [],
        }}
        onClose={onClose}
        onCancelExport={vi.fn()}
        onExport={vi.fn()}
        onOpenFFmpegSetup={vi.fn()}
      />,
    );
    return { onClose };
  };

  it('says where the file went, can show it, and offers to share it', async () => {
    const { onClose } = renderDone('/Users/test/output.mp4');
    expect(screen.getByText(/export completed/i)).toBeInTheDocument();
    expect(screen.getByText(/saved to \/users\/test\/output\.mp4/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show in folder/i }));
    expect(mockRevealExportInFolder).toHaveBeenCalledWith('/Users/test/output.mp4');

    const panel = JSON.parse(screen.getByTestId('share-panel').textContent ?? '{}');
    expect(panel).toEqual({
      filePath: '/Users/test/output.mp4',
      format: 'mp4',
      durationS: 60,
      title: 'My Recording',
      projectId: null,
    });

    expect(screen.queryByRole('button', { name: /^export$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes the exported format, so GIF and MOV can explain they cannot be shared', () => {
    renderDone('/Users/test/output.gif');
    const panel = JSON.parse(screen.getByTestId('share-panel').textContent ?? '{}');
    expect(panel.format).toBe('gif');
  });
});
