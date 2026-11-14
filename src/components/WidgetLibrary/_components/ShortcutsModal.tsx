import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shortcutKeys } from 'src/lib/captureShortcuts';
import { IconX } from 'src/lib/icons';
import { Button, Dialog, DialogContent, DialogTitle } from 'src/lib/ui';
import type { RegisteredCaptureShortcuts } from 'src/types';

type ShortcutGroup = {
  label: string;
  shortcuts: { description: string; keys: string[] }[];
};

type TFunction = (key: string) => string;

/** Only the capture shortcuts that registered: one another app holds doesn't work. */
const buildCaptureGroup = (
  live: RegisteredCaptureShortcuts,
  isMac: boolean,
  t: TFunction,
): ShortcutGroup[] => {
  const shortcuts = [
    { description: t('takeScreenshot'), accelerator: live.screenshot },
    { description: t('openRecordingToolbar'), accelerator: live.record },
  ].flatMap(({ description, accelerator }) =>
    accelerator ? [{ description, keys: shortcutKeys(accelerator, isMac) }] : [],
  );
  return shortcuts.length > 0 ? [{ label: t('captureAnywhere'), shortcuts }] : [];
};

const buildGroups = (
  isMac: boolean,
  t: TFunction,
  live: RegisteredCaptureShortcuts,
): ShortcutGroup[] => {
  const mod = isMac ? '⌘' : 'Ctrl';
  const shift = isMac ? '⇧' : 'Shift';
  const del = isMac ? '⌫' : 'Del';

  return [
    ...buildCaptureGroup(live, isMac, t),
    {
      label: t('playback'),
      shortcuts: [{ description: t('playPause'), keys: ['Space'] }],
    },
    {
      label: t('editing'),
      shortcuts: [
        { description: t('undo'), keys: [mod, 'Z'] },
        { description: t('redo'), keys: [mod, shift, 'Z'] },
        { description: t('splitAtPlayhead'), keys: [mod, 'B'] },
        { description: t('deleteSelected'), keys: [del] },
      ],
    },
    {
      label: t('addEffects'),
      shortcuts: [
        { description: t('addZoom'), keys: ['Z'] },
        { description: t('addCinematicZoom'), keys: [shift, 'Z'] },
        { description: t('addText'), keys: ['T'] },
        { description: t('addMask'), keys: ['M'] },
      ],
    },
    {
      label: t('view'),
      shortcuts: [
        { description: t('toggleFocusMode'), keys: ['`'] },
        { description: t('captureFrame'), keys: [mod, shift, 'C'] },
      ],
    },
    {
      label: t('recording'),
      shortcuts: [
        { description: t('nextScene'), keys: [mod, isMac ? '⌥' : 'Alt', ']'] },
        { description: t('prevScene'), keys: [mod, isMac ? '⌥' : 'Alt', '['] },
      ],
    },
  ];
};

type ShortcutsModalProps = {
  open: boolean;
  onClose: () => void;
};

export const ShortcutsModal = ({ open, onClose }: ShortcutsModalProps) => {
  const { t } = useTranslation('shortcuts');
  const isMac = navigator.platform.startsWith('Mac');
  const [liveCaptureShortcuts, setLiveCaptureShortcuts] = useState<RegisteredCaptureShortcuts>({});
  const groups = buildGroups(isMac, t, liveCaptureShortcuts);

  useEffect(() => {
    if (!open) {
      return;
    }
    window.screenforge
      .getCaptureShortcuts()
      .then(setLiveCaptureShortcuts)
      .catch(() => setLiveCaptureShortcuts({}));
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-sm bg-sf-panel border-sf-border p-0 gap-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={() => onClose()}
      >
        <div className="flex items-center justify-between border-b border-sf-border px-5 py-4">
          <DialogTitle className="text-sf-primary">{t('title')}</DialogTitle>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <IconX size={14} />
          </Button>
        </div>

        <div className="flex max-h-[70vh] flex-col overflow-y-auto px-5 pb-5">
          {groups.map((group) => (
            <div key={group.label} className="pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-widest text-sf-muted">
                {group.label}
              </p>
              {group.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.description}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="text-sm text-sf-secondary">{shortcut.description}</span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, i) => (
                      <kbd
                        key={i}
                        className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded border border-sf-border bg-sf-bg px-1.5 font-mono text-xs leading-none text-sf-secondary"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
