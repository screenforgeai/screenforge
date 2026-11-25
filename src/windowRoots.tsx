import type { ReactNode } from 'react';
import SplashScreen from './components/SplashScreen';

/**
 * The UI for each window, by URL hash. Every window is a separate page load of the
 * same bundle, so each one imports only its own code: a toolbar or area-selector
 * window no longer parses and runs the whole editor first.
 *
 * The splash stays in the entry chunk: the main process shows it on
 * did-finish-load, which would otherwise come before its chunk arrives.
 */
export async function loadWindowRoot(hash: string): Promise<ReactNode> {
  switch (hash) {
    case 'splash':
      return <SplashScreen />;
    case 'toolbar': {
      const { FloatingToolbar } = await import('./components/FloatingToolbar');
      return <FloatingToolbar />;
    }
    case 'export-worker': {
      const { default: ExportWorker } = await import('./components/ExportWorker');
      return <ExportWorker />;
    }
    case 'teleprompter': {
      const { Teleprompter } = await import('./components/Teleprompter/Teleprompter');
      return <Teleprompter />;
    }
    case 'scene-overlay': {
      const { SceneOverlayWindow } =
        await import('./components/WidgetLibrary/_components/SceneOverlay');
      return <SceneOverlayWindow />;
    }
    case 'camera-preview': {
      const { CameraPreviewWindow } =
        await import('./components/CameraPreview/CameraPreviewWindow');
      return <CameraPreviewWindow />;
    }
    case 'area-selector':
    case 'area-selector-screenshot':
    case 'area-selector-still':
    case 'area-selector-record-still': {
      const { AreaSelector } = await import('./components/AreaSelector/AreaSelector');
      if (hash === 'area-selector') {
        return <AreaSelector />;
      }
      return (
        <AreaSelector
          purpose={
            hash === 'area-selector-screenshot'
              ? 'screenshot'
              : hash === 'area-selector-still'
                ? 'screenshot-still'
                : 'record-still'
          }
        />
      );
    }
    default: {
      const { default: App } = await import('./app');
      return <App />;
    }
  }
}
