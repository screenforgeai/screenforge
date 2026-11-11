import { useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowUpRight, IconX } from 'src/lib/icons';
import { CHANGELOG_URL } from 'src/lib/siteLinks';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from 'src/lib/ui';
import {
  splitFirstSentence,
  splitTitle,
  type ReleaseNoteItem,
  type ReleaseNotes,
} from 'src/lib/whatsNew/changelog';

type WhatsNewModalProps = {
  open: boolean;
  /** Newest first. */
  releases: ReleaseNotes[];
  onClose: () => void;
};

/** Fixes listed before "Show N more". */
const VISIBLE_FIXES = 4;

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

const VersionPill = ({ children }: { children: string }) => (
  <span className="inline-flex h-6 items-center rounded-full border border-sf-border bg-sf-bg px-2.5 text-xs font-medium tabular-nums text-sf-secondary">
    {children}
  </span>
);

// All entry text renders as React text nodes, never as HTML.

/** First sentence carries the point; the rest is supporting detail. */
const LeadParagraph = ({ text, className }: { text: string; className: string }) => {
  const { lead, rest } = splitFirstSentence(text);
  return (
    <p className={className}>
      <span className="text-sf-primary">{lead}</span>
      {rest && <span className="text-sf-secondary"> {rest}</span>}
    </p>
  );
};

const Details = ({ details }: { details: string[] }) =>
  details.length > 0 ? (
    <ul className="mt-2 flex flex-col gap-1.5 border-l border-sf-border pl-3">
      {details.map((detail, index) => (
        <li key={index} className="text-[13px] leading-relaxed text-sf-secondary">
          {detail}
        </li>
      ))}
    </ul>
  ) : null;

/** Every feature gets a heading: its own "Label:" title, else its first sentence. */
const featureHeading = (text: string): { title: string; body: string } => {
  const titled = splitTitle(text);
  if (titled) {
    return titled;
  }
  const { lead, rest } = splitFirstSentence(text);
  // Headings don't end in a full stop.
  return { title: lead.replace(/\.$/, ''), body: rest };
};

const Feature = ({ item }: { item: ReleaseNoteItem }) => {
  const { title, body } = featureHeading(item.text);
  return (
    <article>
      <h4 className="text-[15px] font-semibold leading-snug tracking-tight text-sf-primary">
        {title}
      </h4>
      {body && <p className="mt-1.5 text-sm leading-[1.7] text-sf-secondary">{body}</p>}
      <Details details={item.details} />
    </article>
  );
};

type FixesProps = {
  items: ReleaseNoteItem[];
  /** Called after "Show more" unmounts, so focus can go back to the notes. */
  onExpanded: () => void;
};

const Fixes = ({ items, onExpanded }: FixesProps) => {
  const { t } = useTranslation('whatsNew');
  const [expanded, setExpanded] = useState(false);
  const hidden = items.length - VISIBLE_FIXES;
  const visible = expanded || hidden <= 0 ? items : items.slice(0, VISIBLE_FIXES);

  return (
    <div>
      <h4 className="flex items-baseline gap-2 text-[13px] font-semibold text-sf-primary">
        {t('sectionFixes')}
        <span className="font-normal tabular-nums text-sf-muted">{items.length}</span>
      </h4>
      <ul className="mt-3 flex flex-col gap-3">
        {visible.map((item, index) => (
          <li key={index}>
            <LeadParagraph text={item.text} className="text-[13px] leading-[1.65]" />
            <Details details={item.details} />
          </li>
        ))}
      </ul>
      {!expanded && hidden > 0 && (
        <button
          type="button"
          className="mt-3 cursor-pointer text-[13px] text-sf-secondary transition-colors hover:text-sf-primary"
          onClick={() => {
            setExpanded(true);
            onExpanded();
          }}
        >
          {t('showMore', { count: hidden })}
        </button>
      )}
    </div>
  );
};

type ReleaseContentProps = {
  release: ReleaseNotes;
  onFixesExpanded: () => void;
};

const ReleaseContent = ({ release, onFixesExpanded }: ReleaseContentProps) => (
  <div className="flex flex-col gap-8">
    {release.newItems.length > 0 && (
      <div className="flex flex-col gap-6">
        {release.newItems.map((item, index) => (
          <Feature key={index} item={item} />
        ))}
      </div>
    )}
    {release.fixItems.length > 0 && (
      <div className={release.newItems.length > 0 ? 'border-t border-sf-border/60 pt-7' : ''}>
        <Fixes items={release.fixItems} onExpanded={onFixesExpanded} />
      </div>
    )}
  </div>
);

export const WhatsNewModal = ({ open, releases, onClose }: WhatsNewModalProps) => {
  const { t } = useTranslation('whatsNew');
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const latest = releases[0];
  const isRange = releases.length > 1;

  // "Show more" removes itself; keep keyboard focus on the notes, not the dialog.
  const focusNotes = () => scrollRef.current?.focus({ preventScroll: true });

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
        className="flex max-h-[min(720px,calc(100vh-4rem))] w-[640px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-xl border-sf-border bg-sf-panel p-0 shadow-[0_24px_80px_rgba(0,0,0,0.5)] outline-none sm:max-w-[640px]"
        onOpenAutoFocus={(event) => {
          // Focus the notes (no ring on a button) so arrow keys scroll and Enter dismisses.
          event.preventDefault();
          // focusVisible: false keeps the keyboard ring off until the user tabs.
          scrollRef.current?.focus({ focusVisible: false } as FocusOptions);
        }}
        onKeyDown={(event) => {
          // Buttons keep their own Enter behaviour.
          if (event.key === 'Enter' && !(event.target as HTMLElement).closest('button')) {
            event.preventDefault();
            onClose();
          }
        }}
        {...(reduceMotion ? FADE_IN : SPRING_IN)}
      >
        <div className="relative px-8 pb-6 pt-7">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('close')}
            className="absolute right-4 top-4"
            onClick={onClose}
          >
            <IconX size={14} />
          </Button>
          <VersionPill>{t('versionBadge', { version: latest.version })}</VersionPill>
          <DialogTitle className="mt-4 text-2xl font-semibold tracking-tight text-sf-primary">
            {t('title')}
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-sm text-sf-secondary">
            {isRange ? t('subtitleRange') : t('subtitleSingle', { version: latest.version })}
          </DialogDescription>
        </div>

        <div
          ref={scrollRef}
          // Tabbable so keyboard users can come back and scroll long notes.
          tabIndex={0}
          aria-label={t('title')}
          className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sf-border-lt"
        >
          {isRange ? (
            releases.map((release) => (
              <section
                key={release.version}
                className="border-t border-sf-border/60 py-7 first:border-t-0 first:pt-1 last:pb-0"
              >
                <h3 className="mb-5">
                  <VersionPill>{t('versionHeading', { version: release.version })}</VersionPill>
                </h3>
                <ReleaseContent release={release} onFixesExpanded={focusNotes} />
              </section>
            ))
          ) : (
            <div className="pt-1">
              <ReleaseContent release={latest} onFixesExpanded={focusNotes} />
            </div>
          )}
        </div>

        <DialogFooter className="items-center justify-between border-t border-sf-border/60 px-6 py-3.5 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 px-2 text-sf-secondary"
            onClick={() => window.screenforge.openExternalUrl(CHANGELOG_URL)}
          >
            {t('fullChangelog')}
            <IconArrowUpRight size={14} />
          </Button>
          <Button
            type="button"
            size="sm"
            className="shadow-none transition-transform active:scale-[0.98]"
            onClick={onClose}
          >
            {t('gotIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
