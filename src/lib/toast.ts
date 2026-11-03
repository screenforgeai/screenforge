import type { CSSProperties } from 'react';

export function getToasterStyle(): CSSProperties {
  return {};
}

export function getToastStyle(): CSSProperties {
  return {
    left: 0,
    right: 0,
    width: 'max-content',
    maxWidth: 'min(92vw, 32rem)',
    marginInline: 'auto',
  };
}

export const TOASTER_TOAST_CLASSNAMES = {
  toast: 'rounded-xl border border-white/10 bg-[#121216] px-3 py-2 text-sf-primary shadow-2xl',
  content: 'gap-1',
  title: 'text-sm leading-5',
  error: 'border-[#3f1c22] text-[#ffb4bd]',
} as const;
