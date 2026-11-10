import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FRAME, useStore } from 'src/store';
import { DEFAULT_BACKGROUND } from 'src/lib/effects/frame/analyze';
import { getCustomWallpaperUrl, setCustomWallpaperUrl } from 'src/lib/effects/frame/wallpapers';
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_CAPTION_APPEARANCE,
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
} from 'src/store/defaults';
import type { RecordingResult, StylePreset } from 'src/types';
import { StylesDropdown } from './StylesDropdown';

const RECORDING_RESULT: RecordingResult = {
  filePath: '/tmp/test-recording.mp4',
  mouseData: [],
  duration: 12,
  startTime: 0,
  recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const LOGO_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const WALLPAPER_DATA_URL = 'data:image/jpeg;base64,/9j/';

const BRAND_KIT: StylePreset = {
  id: 'director-brand-kit',
  name: 'Acme',
  savedAt: '2026-11-06T10:00:00.000Z',
  source: 'director',
  background: { ...DEFAULT_BACKGROUND, type: 'solid', solidColor: '#112233' },
  cursor: { ...DEFAULT_CURSOR_SETTINGS, size: 150 },
  captionsAppearance: {
    ...DEFAULT_CAPTION_APPEARANCE,
    fontFamily: 'Georgia',
    textColor: '#fafafa',
  },
  font: 'Georgia',
  logo: {
    path: '/ud/preset-assets/director-brand-kit/logo.png',
    corner: 'top-right',
    size: 0.12,
    opacity: 90,
  },
};

const OWN: StylePreset = {
  id: 'preset_1',
  name: 'Dark Studio',
  savedAt: '2026-01-01T00:00:00.000Z',
  background: { ...DEFAULT_BACKGROUND, wallpaperSeed: -1 },
  cursor: DEFAULT_CURSOR_SETTINGS,
  camera: DEFAULT_CAMERA_SETTINGS,
  keyboard: DEFAULT_KEYBOARD_SETTINGS,
  captionsAppearance: DEFAULT_CAPTION_APPEARANCE,
  customWallpaperPath: '/ud/preset-assets/preset_1/wallpaper.jpg',
};

let presetsChanged: (() => void) | null;
let api: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  presetsChanged = null;
  api = {
    getPresets: vi.fn().mockResolvedValue([BRAND_KIT, OWN]),
    refreshBrandKit: vi.fn().mockResolvedValue(undefined),
    onPresetsChanged: vi.fn((cb: () => void) => {
      presetsChanged = cb;
      return () => undefined;
    }),
    getPresetAssets: vi.fn(async (id: string) =>
      id === BRAND_KIT.id
        ? { logoDataUrl: LOGO_DATA_URL, customWallpaperDataUrl: null }
        : { logoDataUrl: null, customWallpaperDataUrl: WALLPAPER_DATA_URL },
    ),
    savePreset: vi.fn(async (draft: { name: string }) => ({
      ...OWN,
      id: 'preset_2',
      name: draft.name,
    })),
    duplicatePreset: vi.fn(async (_id: string, name: string) => ({
      ...BRAND_KIT,
      id: 'preset_3',
      source: undefined,
      name,
    })),
    deletePreset: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, 'screenforge', { value: api, writable: true, configurable: true });

  act(() => {
    useStore.getState().resetEditorSession();
    useStore.getState().loadRecordingSession(RECORDING_RESULT);
    useStore.getState().setFrame(DEFAULT_FRAME);
  });
  setCustomWallpaperUrl(null);
});

afterEach(() => {
  cleanup();
});

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<StylesDropdown />);
  await waitFor(() => expect(api.getPresets).toHaveBeenCalled());
  await user.click(screen.getByRole('button', { name: /preset/i }));
  return screen.findByRole('menu');
};

describe('StylesDropdown', () => {
  it('lists the workspace brand kit first, read-only, then this app’s presets', async () => {
    const user = userEvent.setup();
    const menu = await openMenu(user);
    expect(api.refreshBrandKit).toHaveBeenCalled();

    const rows = within(menu).getAllByRole('menuitem');
    expect(rows[0]).toHaveTextContent('Brand kit');
    expect(rows[0]).toHaveTextContent('Acme');
    expect(rows[1]).toHaveTextContent('Dark Studio');
    expect(within(menu).queryByRole('button', { name: 'Delete Brand kit' })).toBeNull();
    expect(within(menu).getByRole('button', { name: 'Delete Dark Studio' })).toBeInTheDocument();
    expect(
      within(menu).getByRole('button', { name: 'Save Brand kit as a new preset' }),
    ).toBeInTheDocument();
  });

  it('reloads the list when the brand kit changes', async () => {
    render(<StylesDropdown />);
    await waitFor(() => expect(api.getPresets).toHaveBeenCalledTimes(1));
    api.getPresets.mockResolvedValue([OWN]);
    act(() => presetsChanged?.());
    await waitFor(() => expect(api.getPresets).toHaveBeenCalledTimes(2));
  });

  it('applies the brand kit with its logo and font, as one undoable edit', async () => {
    const user = userEvent.setup();
    const menu = await openMenu(user);
    await user.click(within(menu).getAllByRole('menuitem')[0]);

    await waitFor(() => expect(useStore.getState().frame.logo?.src).toBe(LOGO_DATA_URL));
    const state = useStore.getState();
    expect(api.getPresetAssets).toHaveBeenCalledWith('director-brand-kit');
    expect(state.frame.logo).toMatchObject({ corner: 'top-right', size: 0.12, opacity: 90 });
    expect(state.frame.background.solidColor).toBe('#112233');
    expect(state.cursorSize).toBe(150);
    expect(state.captions.fontFamily).toBe('Georgia');
    expect(state.captions.textColor).toBe('#fafafa');

    act(() => useStore.getState().undo());
    expect(useStore.getState().frame.logo ?? null).toBeNull();
  });

  it('restores a preset’s saved custom wallpaper', async () => {
    const user = userEvent.setup();
    const menu = await openMenu(user);
    await user.click(within(menu).getAllByRole('menuitem')[1]);

    await waitFor(() => expect(getCustomWallpaperUrl()).toBe(WALLPAPER_DATA_URL));
    expect(useStore.getState().frame.background.wallpaperSeed).toBe(-1);
  });

  it('saves the brand kit as a new, editable preset', async () => {
    const user = userEvent.setup();
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('button', { name: 'Save Brand kit as a new preset' }));

    const name = await screen.findByRole('textbox');
    expect(name).toHaveValue('Acme copy');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.duplicatePreset).toHaveBeenCalledWith('director-brand-kit', 'Acme copy'),
    );
    expect(api.savePreset).not.toHaveBeenCalled();
  });

  it('saves the current style with its logo, custom wallpaper and chosen font', async () => {
    const user = userEvent.setup();
    act(() => {
      useStore.getState().setFrame({
        ...DEFAULT_FRAME,
        background: { ...DEFAULT_BACKGROUND, wallpaperSeed: -1 },
        logo: { src: LOGO_DATA_URL, corner: 'top-left', size: 0.1, opacity: 100 },
      });
    });
    setCustomWallpaperUrl(WALLPAPER_DATA_URL);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('button', { name: 'Create new' }));

    await user.type(await screen.findByRole('textbox'), 'Launch');
    await user.click(screen.getByRole('combobox', { name: 'Font' }));
    await user.click(await screen.findByRole('option', { name: 'Serif (Georgia)' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.savePreset).toHaveBeenCalled());
    expect(api.savePreset.mock.calls[0][0]).toMatchObject({
      name: 'Launch',
      font: 'Georgia',
      logo: { dataUrl: LOGO_DATA_URL, corner: 'top-left' },
      customWallpaperDataUrl: WALLPAPER_DATA_URL,
    });
  });
});
