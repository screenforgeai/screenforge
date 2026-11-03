import '@testing-library/jest-dom/vitest';
import './i18n';

/* eslint-disable @typescript-eslint/no-empty-function */

// Radix UI components use ResizeObserver internally; jsdom doesn't ship it.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (typeof window !== 'undefined') {
  window.scrollTo = () => {};

  // Node ≥22 defines a broken global localStorage (an empty object unless
  // --localstorage-file is set) that shadows jsdom's working implementation.
  // Install a functional in-memory Storage so component code and tests work.
  if (typeof globalThis.localStorage?.clear !== 'function') {
    const store = new Map<string, string>();
    const memoryStorage: Storage = {
      get length() {
        return store.size;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: memoryStorage,
      configurable: true,
      writable: true,
    });
  }
}

if (typeof Element !== 'undefined') {
  // Radix UI Select uses pointer-capture APIs not implemented in jsdom.
  // Without these stubs the trigger's onPointerDown handler throws.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }

  // Radix Select scrolls items into view; jsdom doesn't implement scrollIntoView.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

/* eslint-enable @typescript-eslint/no-empty-function */
