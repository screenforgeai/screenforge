import { createRoot } from 'react-dom/client';
import './i18n';
import './i18n.types';
import './index.css';
import SplashScreen from './components/SplashScreen';
import { FloatingToolbar } from './components/FloatingToolbar';
import { CameraPreviewWindow } from './components/CameraPreview/CameraPreviewWindow';
import ExportWorker from './components/ExportWorker';
import { Teleprompter } from './components/Teleprompter/Teleprompter';
import { SceneOverlayWindow } from './components/WidgetLibrary/_components/SceneOverlay';
import { AreaSelector } from './components/AreaSelector/AreaSelector';
import App from './app';
import { captureException } from './lib/analytics';

const hash = window.location.hash.slice(1); // strip leading #

window.addEventListener('error', (event) => {
  window.screenforge.writeDiagnosticLog('renderer.error', {
    hash,
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
  captureException(event.error ?? event.message, { window: hash || 'main', kind: 'error' });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason =
    event.reason instanceof Error
      ? {
          message: event.reason.message,
          stack: event.reason.stack,
        }
      : event.reason;

  window.screenforge.writeDiagnosticLog('renderer.unhandledrejection', {
    hash,
    reason,
  });
  captureException(event.reason, { window: hash || 'main', kind: 'unhandledrejection' });
});

// Toolbar window is fully transparent — body must not paint a bg.
if (
  hash === 'toolbar' ||
  hash === 'teleprompter' ||
  hash === 'scene-overlay' ||
  hash === 'camera-preview' ||
  hash === 'area-selector' ||
  hash === 'area-selector-screenshot'
) {
  document.body.classList.add('transparent-window');
}

let rootNode: React.ReactNode;
switch (hash) {
  case 'splash':
    rootNode = <SplashScreen />;
    break;
  case 'toolbar':
    rootNode = <FloatingToolbar />;
    break;
  case 'export-worker':
    rootNode = <ExportWorker />;
    break;
  case 'teleprompter':
    rootNode = <Teleprompter />;
    break;
  case 'scene-overlay':
    rootNode = <SceneOverlayWindow />;
    break;
  case 'camera-preview':
    rootNode = <CameraPreviewWindow />;
    break;
  case 'area-selector':
    rootNode = <AreaSelector />;
    break;
  case 'area-selector-screenshot':
    rootNode = <AreaSelector purpose="screenshot" />;
    break;
  case 'area-selector-still':
    rootNode = <AreaSelector purpose="screenshot-still" />;
    break;
  default:
    rootNode = <App />;
}

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(rootNode);
