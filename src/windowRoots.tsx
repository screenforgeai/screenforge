import type { ReactNode } from 'react';
import SplashScreen from './components/SplashScreen';
import { OnboardingWindow } from './components/Onboarding/OnboardingWindow';

/**
 * The UI for each window, by URL hash. Every window is a separate page load of the
 * same bundle, so each one imports only its own code: a toolbar or area-selector
 * window no longer parses and runs the whole editor first.
 *
 * The splash and onboarding stay in the entry chunk: the main process shows
 * them on did-finish-load / ready-to-show, which would otherwise come before
 * their chunk arrives, and both are opaque first-launch windows. Both are small.
 */
export async function loadWindowRoot(hash: string): Promise<ReactNode> {
  switch (hash) {
    case 'splash':
      return <SplashScreen />;
    case 'onboarding':
      return <OnboardingWindow />;
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
    case 'display-picker': {
      const { DisplayPicker } = await import('./components/DisplayPicker/DisplayPicker');
      return <DisplayPicker />;
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
