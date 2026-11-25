import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Each window module records when it is loaded: a window must load only its own.
const loaded = vi.hoisted(() => new Set<string>());
const stub = (name: string) => {
  loaded.add(name);
  const Component = () => null;
  Component.displayName = name;
  return Component;
};

vi.mock('./components/SplashScreen', () => ({ default: stub('SplashScreen') }));
vi.mock('./app', () => ({ default: stub('App') }));
vi.mock('./components/FloatingToolbar', () => ({ FloatingToolbar: stub('FloatingToolbar') }));
vi.mock('./components/ExportWorker', () => ({ default: stub('ExportWorker') }));
vi.mock('./components/Teleprompter/Teleprompter', () => ({ Teleprompter: stub('Teleprompter') }));
vi.mock('./components/WidgetLibrary/_components/SceneOverlay', () => ({
  SceneOverlayWindow: stub('SceneOverlayWindow'),
}));
vi.mock('./components/CameraPreview/CameraPreviewWindow', () => ({
  CameraPreviewWindow: stub('CameraPreviewWindow'),
}));
vi.mock('./components/AreaSelector/AreaSelector', () => ({ AreaSelector: stub('AreaSelector') }));

const { loadWindowRoot } = await import('./windowRoots');

const componentName = (node: unknown) =>
  isValidElement(node) ? (node.type as { displayName?: string }).displayName : undefined;

describe('window roots', () => {
  it('has the splash ready without loading anything else', async () => {
    const node = await loadWindowRoot('splash');
    expect(componentName(node)).toBe('SplashScreen');
    expect([...loaded]).toEqual(['SplashScreen']);
  });

  it.each([
    ['toolbar', 'FloatingToolbar'],
    ['export-worker', 'ExportWorker'],
    ['teleprompter', 'Teleprompter'],
    ['scene-overlay', 'SceneOverlayWindow'],
    ['camera-preview', 'CameraPreviewWindow'],
    ['area-selector', 'AreaSelector'],
  ])('#%s loads its own UI, not the editor', async (hash, name) => {
    const node = await loadWindowRoot(hash);
    expect(componentName(node)).toBe(name);
    expect(loaded.has('App')).toBe(false);
  });

  it.each([
    ['area-selector-screenshot', 'screenshot'],
    ['area-selector-still', 'screenshot-still'],
    ['area-selector-record-still', 'record-still'],
  ])('#%s opens the area selector for %s', async (hash, purpose) => {
    const node = await loadWindowRoot(hash);
    expect(componentName(node)).toBe('AreaSelector');
    expect(isValidElement(node) && (node.props as { purpose?: string }).purpose).toBe(purpose);
  });

  it('opens the editor for the main window', async () => {
    const node = await loadWindowRoot('');
    expect(componentName(node)).toBe('App');
  });
});
