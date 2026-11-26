import { createRoot } from 'react-dom/client';
import './i18n';
import './i18n.types';
import './index.css';
import { captureException } from './lib/analytics';
import { loadWindowRoot } from './windowRoots';

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
  hash === 'area-selector-screenshot' ||
  hash === 'display-picker'
) {
  document.body.classList.add('transparent-window');
}

const root = createRoot(document.getElementById('root') as HTMLElement);
void loadWindowRoot(hash).then((node) => {
  root.render(node);
});
