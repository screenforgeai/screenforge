import { useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSparkles } from 'src/lib/icons';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from 'src/lib/ui';
import type { ReleaseNoteItem, ReleaseNotes } from 'src/lib/whatsNew/changelog';

type WhatsNewModalProps = {
  open: boolean;
  /** Newest first. */
  releases: ReleaseNotes[];
  onClose: () => void;
};

const SPRING_IN = {
  initial: { opacity: 0, transform: 'translateY(8px) scale(0.98)' },
  animate: { opacity: 1, transform: 'translateY(0px) scale(1)' },
  exit: { opacity: 0, transform: 'translateY(4px) scale(0.98)' },
  transition: { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 },
} as const;

const FADE_IN = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.12 },
} as const;

type NoteSectionProps = {
  label: string;
  items: ReleaseNoteItem[];
  accent: boolean;
};

// Entry text is rendered as React text nodes only, never as HTML.
const NoteSection = ({ label, items, accent }: NoteSectionProps) => (
  <div>
    <p className="mb-2.5 text-[11px] font-medium uppercase tracking-widest text-sf-muted">
      {label}
    </p>
    <ul className="flex flex-col gap-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span
            aria-hidden="true"
            className={`mt-[9px] size-1.5 shrink-0 rounded-full ${
              accent ? 'bg-primary' : 'bg-sf-border-lt'
            }`}
          />
          <div className="min-w-0 max-w-[62ch]">
            <p className="text-sm leading-6 text-sf-primary">{item.text}</p>
            {item.details.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1">
                {item.details.map((detail, detailIndex) => (
                  <li key={detailIndex} className="text-[13px] leading-5 text-sf-secondary">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  </div>
);

const ReleaseBody = ({ release }: { release: ReleaseNotes }) => {
  const { t } = useTranslation('whatsNew');
  return (
    <div className="flex flex-col gap-6">
      {release.newItems.length > 0 && (
        <NoteSection label={t('sectionNew')} items={release.newItems} accent />
      )}
      {release.fixItems.length > 0 && (
        <NoteSection label={t('sectionFixes')} items={release.fixItems} accent={false} />
      )}
    </div>
  );
};

export const WhatsNewModal = ({ open, releases, onClose }: WhatsNewModalProps) => {
  const { t } = useTranslation('whatsNew');
  const reduceMotion = useReducedMotion();
  const gotItRef = useRef<HTMLButtonElement>(null);
  const latest = releases[0];
  const isRange = releases.length > 1;

  if (!latest) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(640px,calc(100vh-4rem))] w-[520px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-xl border-sf-border bg-sf-panel p-0 shadow-[0_24px_64px_rgba(0,0,0,0.45)] sm:max-w-[520px]"
        onOpenAutoFocus={(event) => {
          // Focus the one action so Enter dismisses straight away.
          event.preventDefault();
          gotItRef.current?.focus();
        }}
        {...(reduceMotion ? FADE_IN : SPRING_IN)}
      >
        <div className="px-6 pb-5 pt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/12 text-primary">
              <IconSparkles size={15} />
            </span>
            <span className="rounded-full border border-sf-border px-2 py-0.5 text-[11px] font-medium tabular-nums leading-4 text-sf-secondary">
              {t('versionBadge', { version: latest.version })}
            </span>
          </div>
          <DialogTitle className="text-lg font-semibold leading-tight text-sf-primary">
            {t('title')}
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-sm leading-5 text-sf-secondary">
            {isRange ? t('subtitleRange') : t('subtitleSingle', { version: latest.version })}
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-sf-border px-6 py-5">
          {isRange ? (
            <div className="flex flex-col gap-7">
              {releases.map((release) => (
                <section key={release.version} className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-3 text-xs font-medium tabular-nums text-sf-secondary">
                    {t('versionHeading', { version: release.version })}
                    <span aria-hidden="true" className="h-px flex-1 bg-sf-border" />
                  </h3>
                  <ReleaseBody release={release} />
                </section>
              ))}
            </div>
          ) : (
            <ReleaseBody release={latest} />
          )}
        </div>

        <div className="flex justify-end border-t border-sf-border px-6 py-4">
          <Button ref={gotItRef} size="sm" className="min-w-20" onClick={onClose}>
            {t('gotIt')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
