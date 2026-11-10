import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { trackEvent } from 'src/lib/analytics';
import {
  IconBlur,
  IconCaptions,
  IconChatFeedback,
  IconCommand,
  IconFolder,
  IconHeart,
  IconKeyboard,
  IconFilm,
  IconMotion,
  IconMusic3,
  IconPhoto,
  IconPlus,
  IconPointer,
  IconPlayerRecord,
  IconText,
  IconUpload,
  IconVideo,
  IconZoom,
  IconSettings,
} from 'src/lib/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../lib/ui';
import { useImportVideo } from '../../hooks/useImportVideo';
import type { WidgetTab } from '../../store';
import { useStore } from '../../store';
import ConfirmModal from '../ConfirmModal';
import { WIDGET_LIBRARY_WIDTH_CLASS, WIDGET_NAV_WIDTH_CLASS } from '../layout';
import { CursorWidget } from './_components/CursorWidget';
import { CameraWidget } from './_components/CameraWidget';
import { MaskWidget } from './_components/MaskWidget';
import { FrameWidget } from './_components/FrameWidget';
import { KeyboardWidget } from './_components/KeyboardWidget';
import { RecordingWidget } from './_components/RecordingWidget';
import { ZoomWidget } from './_components/ZoomWidget';
import { VideoWidget } from './_components/VideoWidget';
import { CaptionWidget } from './_components/CaptionWidget';
import { TextWidget } from './_components/TextWidget';
import { MusicWidget } from './_components/MusicWidget';
import { MotionWidget } from './_components/MotionWidget';
import { useNewRecordingFlow } from './_hooks/useNewRecordingFlow';
import { FeedbackModal } from './_components/FeedbackModal';
import { ShortcutsModal } from './_components/ShortcutsModal';
import { CreateScenesModal } from './_components/CreateScenesModal';
import { OVERLAY_SCENES_KEY } from './_components/SceneOverlay';
import { SettingsModal } from './_components/SettingsModal';
import { WhatsNewButton } from '../WhatsNew/WhatsNewButton';

const KOFI_URL = 'https://ko-fi.com/mohibarshi';

const COMING_SOON_NAV_ITEMS: { icon: React.ReactNode; label: string }[] = [
  // { icon: <IconPencil className="size-5" />, label: 'Text' },
  // { icon: <IconAiMagic className="size-5" />, label: 'AI' },
];

const WIDGET_MAP: Record<WidgetTab, React.ReactNode> = {
  recordings: <RecordingWidget />,
  video: <VideoWidget />,
  zoom: <ZoomWidget />,
  motion: <MotionWidget />,
  cursor: <CursorWidget />,
  frame: <FrameWidget />,
  camera: <CameraWidget />,
  mask: <MaskWidget />,
  keyboard: <KeyboardWidget />,
  captions: <CaptionWidget />,
  text: <TextWidget />,
  music: <MusicWidget />,
};

export const WidgetLibrary = () => {
  const { t } = useTranslation('widgets');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createScenesOpen, setCreateScenesOpen] = useState(false);
  const active = useStore((s) => s.activeWidget);
  const isExporting = useStore((s) => s.isExporting);

  const RECORDINGS_ITEM = {
    id: 'recordings' as WidgetTab,
    icon: <IconFolder className="size-5" />,
    label: t('recordings'),
  };

  const EFFECT_NAV_ITEMS: { id: WidgetTab; icon: React.ReactNode; label: string }[] = [
    { id: 'frame', icon: <IconPhoto className="size-5" />, label: t('frame') },
    { id: 'video', icon: <IconFilm className="size-5" />, label: t('video') },
    { id: 'zoom', icon: <IconZoom className="size-5" />, label: t('zoom') },
    { id: 'motion', icon: <IconMotion className="size-5" />, label: t('motion') },
    { id: 'cursor', icon: <IconPointer className="size-5" />, label: t('cursor') },
    { id: 'keyboard', icon: <IconKeyboard className="size-5" />, label: t('keyboard') },
    { id: 'camera', icon: <IconVideo className="size-5" />, label: t('camera') },
    { id: 'mask', icon: <IconBlur className="size-5" />, label: t('mask') },
    { id: 'captions', icon: <IconCaptions className="size-5" />, label: t('captions') },
    { id: 'music', icon: <IconMusic3 className="size-4.5" />, label: t('music') },
    { id: 'text', icon: <IconText className="size-4" />, label: t('text') },
  ];
  const setActive = useStore((s) => s.setActiveWidget);
  const selectedClip = useStore((s) => s.selectedClip);
  const { scenes, updateScene } = useStore(
    useShallow((s) => ({ scenes: s.scenes, updateScene: s.updateScene })),
  );
  const {
    showUnsavedWarning,
    setShowUnsavedWarning,
    openNewRecording,
    discardAndOpenNewRecording,
  } = useNewRecordingFlow();
  const { isImporting, importAsNewProject } = useImportVideo();

  // Forward scene mutations coming from the overlay window into the store
  useEffect(() => {
    const unsub = window.screenforge.onSceneUpdatedFromOverlay(({ id, patch }) => {
      updateScene(id, patch);
    });
    return unsub;
  }, [updateScene]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'sf:open-scene-modal' && e.newValue) {
        setCreateScenesOpen(true);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  useEffect(() => {
    if (selectedClip?.effectId === 'zoom') {
      setActive('zoom');
      return;
    }
    if (selectedClip?.effectId === 'camera') {
      setActive('camera');
      return;
    }
    if (selectedClip?.effectId === 'mask') {
      setActive('mask');
      return;
    }
    if (selectedClip?.effectId === 'text') {
      setActive('text');
      return;
    }
    if (selectedClip?.effectId === 'music') {
      setActive('music');
      return;
    }
    if (selectedClip?.effectId === 'video') {
      setActive('video');
    }
  }, [selectedClip, setActive]);

  return (
    <>
      <aside className={`${WIDGET_NAV_WIDTH_CLASS} h-full border-r border-sf-border`}>
        <div className="flex h-full flex-col justify-between pb-2 pt-2">
          <div className="flex flex-col items-center gap-1">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={isExporting || isImporting ? 'cursor-not-allowed' : undefined}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-sm"
                        aria-label={t('newRecording')}
                        className={`mb-2 rounded-full${isExporting || isImporting ? ' pointer-events-none' : ''}`}
                        disabled={isExporting || isImporting}
                      >
                        <IconPlus className="size-5" />
                      </Button>
                    </DropdownMenuTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {isExporting
                    ? 'Exporting in progress'
                    : isImporting
                      ? 'Importing…'
                      : t('newRecording')}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right" align="start" className="w-40 p-1">
                <DropdownMenuItem
                  className="cursor-pointer gap-2 py-1.5 px-2 text-sm"
                  onClick={() => void openNewRecording()}
                >
                  <IconPlayerRecord
                    size={11}
                    color="var(--primary)"
                    style={{ position: 'relative', top: '-0.5px' }}
                  />
                  <span className="text-primary">Record</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer gap-2 py-1.5 px-2 text-sm"
                  onClick={() => void importAsNewProject()}
                >
                  <IconUpload size={11} style={{ position: 'relative', top: '-0.5px' }} />
                  <span>Import video</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setActive(RECORDINGS_ITEM.id);
                    trackEvent('widget_opened', { widget: RECORDINGS_ITEM.id });
                  }}
                  className={`flex items-center justify-center size-9 rounded-md transition-colors cursor-pointer ${
                    active === RECORDINGS_ITEM.id
                      ? 'bg-secondary text-sf-primary'
                      : 'text-sf-secondary '
                  }`}
                >
                  {RECORDINGS_ITEM.icon}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{RECORDINGS_ITEM.label}</TooltipContent>
            </Tooltip>

            <div aria-hidden="true" className="my-1 h-px w-5 rounded-full bg-sf-border" />

            {EFFECT_NAV_ITEMS.map(({ id, icon, label }) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setActive(id);
                      trackEvent('widget_opened', { widget: id });
                    }}
                    className={`flex items-center justify-center size-9 rounded-md transition-colors cursor-pointer ${
                      active === id ? 'bg-secondary text-sf-primary' : 'text-sf-secondary '
                    }`}
                  >
                    {icon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ))}

            {COMING_SOON_NAV_ITEMS.map(({ icon, label }) => (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <span className="cursor-not-allowed">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${label} (Coming soon)`}
                      disabled
                      className="pointer-events-none flex size-9 items-center justify-center rounded-md text-sf-secondary"
                    >
                      {icon}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('comingSoon')}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          <div className="flex flex-col items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('kofiSupport')}
                  className="flex size-9 items-center justify-center rounded-md text-sf-secondary transition-colors hover:bg-secondary hover:text-primary"
                  onClick={() => {
                    trackEvent('kofi_clicked', { source: 'sidebar' });
                    window.screenforge.openExternalUrl(KOFI_URL);
                  }}
                >
                  <IconHeart className="size-4.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('kofiSupport')}</TooltipContent>
            </Tooltip>

            <div aria-hidden="true" className="my-1 h-px w-5 rounded-full bg-sf-border" />

            <WhatsNewButton />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('keyboardShortcuts')}
                  className="flex size-9 items-center justify-center rounded-md text-sf-secondary transition-colors hover:bg-secondary hover:text-sf-primary"
                  onClick={() => setShortcutsOpen(true)}
                >
                  <IconCommand className="size-4.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('keyboardShortcuts')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('feedbackSupport')}
                  className="flex size-9 items-center justify-center rounded-md text-sf-secondary transition-colors hover:bg-secondary hover:text-sf-primary"
                  onClick={() => setFeedbackOpen(true)}
                >
                  <IconChatFeedback className="size-4.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('feedbackSupport')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Settings"
                  className="flex size-9 items-center justify-center rounded-md text-sf-secondary transition-colors hover:bg-secondary hover:text-sf-primary"
                  onClick={() => setSettingsOpen(true)}
                >
                  <IconSettings className="size-4.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>

      <div
        className={`${WIDGET_LIBRARY_WIDTH_CLASS} h-full border-r border-sf-border relative overflow-hidden`}
      >
        <AnimatePresence initial={false} mode="sync">
          <motion.div
            key={active}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {WIDGET_MAP[active]}
          </motion.div>
        </AnimatePresence>
      </div>

      <ConfirmModal
        open={showUnsavedWarning}
        title={t('unsavedRecording_title')}
        description={t('unsavedRecording_desc')}
        confirmText={t('discard')}
        variant="destructive"
        onConfirm={discardAndOpenNewRecording}
        onCancel={() => setShowUnsavedWarning(false)}
      >
        <span />
      </ConfirmModal>
      <FeedbackModal
        open={feedbackOpen}
        activeWidget={active}
        onClose={() => setFeedbackOpen(false)}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CreateScenesModal
        open={createScenesOpen}
        onClose={() => setCreateScenesOpen(false)}
        onStartRecording={() => {
          setCreateScenesOpen(false);
          localStorage.setItem(OVERLAY_SCENES_KEY, JSON.stringify(scenes));
          window.screenforge.openSceneOverlay();
          void openNewRecording();
        }}
      />
    </>
  );
};
