import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { IconChevronDown, IconLayers, IconPlus, IconX } from 'src/lib/icons';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Spinner,
} from 'src/lib/ui';
import { useStore } from '../../../store';
import type { CaptionAppearance, StylePreset } from '../../../types';

export const StylesDropdown = () => {
  const [open, setOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [presets, setPresets] = useState<StylePreset[]>([]);

  const {
    recordingResult,
    frame,
    captions,
    cursorEnabled,
    cursorStyle,
    cursorClickEffect,
    cursorSize,
    cursorHalflife,
    cursorMotionBlur,
    cursorMaxTilt,
    cursorHideWhenIdle,
    cursorIdleHideSeconds,
    cursorClickSound,
    cursorClickSoundVolume,
    cursorContinuousTracking,
    camera,
    keyboard,
    commitEdit,
  } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      frame: state.frame,
      captions: state.captions,
      cursorEnabled: state.cursorEnabled,
      cursorStyle: state.cursorStyle,
      cursorClickEffect: state.cursorClickEffect,
      cursorSize: state.cursorSize,
      cursorHalflife: state.cursorHalflife,
      cursorMotionBlur: state.cursorMotionBlur,
      cursorMaxTilt: state.cursorMaxTilt,
      cursorHideWhenIdle: state.cursorHideWhenIdle,
      cursorIdleHideSeconds: state.cursorIdleHideSeconds,
      cursorClickSound: state.cursorClickSound,
      cursorClickSoundVolume: state.cursorClickSoundVolume,
      cursorContinuousTracking: state.cursorContinuousTracking,
      camera: state.camera,
      keyboard: state.keyboard,
      commitEdit: state.commitEdit,
    })),
  );

  useEffect(() => {
    void window.screenforge
      .getPresets()
      .then(setPresets)
      .catch(() => undefined);
  }, []);

  if (!recordingResult) {
    return null;
  }

  const handleApply = (preset: StylePreset) => {
    setOpen(false);
    toast.success(`"${preset.name}" applied`);
    commitEdit('Apply style preset', (state) => ({
      frame: { ...state.frame, background: preset.background },
      cursorEnabled: preset.cursor.enabled,
      cursorStyle: preset.cursor.style,
      cursorClickEffect: preset.cursor.clickEffect,
      cursorSize: preset.cursor.size,
      cursorHalflife: preset.cursor.halflife,
      cursorMotionBlur: preset.cursor.motionBlur,
      cursorMaxTilt: preset.cursor.maxTilt,
      cursorHideWhenIdle: preset.cursor.hideWhenIdle,
      cursorIdleHideSeconds: preset.cursor.idleHideSeconds,
      cursorClickSound: preset.cursor.clickSound,
      cursorClickSoundVolume: preset.cursor.clickSoundVolume,
      cursorContinuousTracking: preset.cursor.continuousTracking,
      camera: {
        ...preset.camera,
        enabled: state.camera.enabled,
        zoomRadiusScale: preset.camera.zoomRadiusScale ?? 1.0,
      },
      keyboard: preset.keyboard,
      captions: {
        ...state.captions,
        fontFamily: preset.captionsAppearance.fontFamily,
        fontScale: preset.captionsAppearance.fontScale,
        bold: preset.captionsAppearance.bold,
        italic: preset.captionsAppearance.italic,
        textColor: preset.captionsAppearance.textColor,
        highlightColor: preset.captionsAppearance.highlightColor,
        textOpacity: preset.captionsAppearance.textOpacity,
        backgroundEnabled: preset.captionsAppearance.backgroundEnabled,
        backgroundColor: preset.captionsAppearance.backgroundColor,
        backgroundOpacity: preset.captionsAppearance.backgroundOpacity,
        backgroundRadius: preset.captionsAppearance.backgroundRadius,
        position: preset.captionsAppearance.position,
      },
    }));
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.screenforge.deletePreset(id);
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  const handleConfirmSave = async () => {
    const name = saveName.trim();
    if (!name) {
      return;
    }
    setIsSaving(true);
    try {
      const captionsAppearance: CaptionAppearance = {
        fontFamily: captions.fontFamily,
        fontScale: captions.fontScale,
        bold: captions.bold,
        italic: captions.italic,
        textColor: captions.textColor,
        highlightColor: captions.highlightColor,
        textOpacity: captions.textOpacity,
        backgroundEnabled: captions.backgroundEnabled,
        backgroundColor: captions.backgroundColor,
        backgroundOpacity: captions.backgroundOpacity,
        backgroundRadius: captions.backgroundRadius,
        position: captions.position,
      };
      const preset: StylePreset = {
        id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        savedAt: new Date().toISOString(),
        background: frame.background,
        cursor: {
          enabled: cursorEnabled,
          style: cursorStyle,
          clickEffect: cursorClickEffect,
          size: cursorSize,
          halflife: cursorHalflife,
          motionBlur: cursorMotionBlur,
          maxTilt: cursorMaxTilt,
          hideWhenIdle: cursorHideWhenIdle,
          idleHideSeconds: cursorIdleHideSeconds,
          clickSound: cursorClickSound,
          clickSoundVolume: cursorClickSoundVolume,
          continuousTracking: cursorContinuousTracking,
        },
        camera,
        keyboard,
        captionsAppearance,
      };
      const saved = await window.screenforge.savePreset(preset);
      setPresets((prev) => [...prev, saved]);
      setSaveDialogOpen(false);
      setSaveName('');
      toast.success(`Preset "${name}" saved`);
    } catch {
      toast.error('Failed to save style');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-sf-border bg-transparent px-2 py-0 text-sm font-medium tracking-[-0.01em] text-sf-secondary transition-[border-color,color,background-color,box-shadow,transform] duration-150 ease-out hover:border-sf-border-lt hover:bg-sf-panel/70 hover:text-sf-primary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-0 data-[state=open]:border-sf-border-lt data-[state=open]:bg-sf-panel data-[state=open]:text-sf-primary data-[state=open]:shadow-[0_1px_1px_rgba(0,0,0,0.12),0_10px_24px_rgba(0,0,0,0.18)]"
          >
            <IconLayers size={14} className="shrink-0 text-sf-secondary" />
            <span className="text-sf-secondary">Preset</span>
            <IconChevronDown
              size={14}
              className="shrink-0 text-sf-muted transition-transform duration-200 ease-out group-data-[state=open]:rotate-180"
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-44">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="group relative flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-sf-primary transition-colors hover:bg-[#1a1a20]"
              onClick={() => handleApply(preset)}
            >
              <span className="flex-1 truncate text-sm">{preset.name}</span>
              <button
                type="button"
                aria-label={`Delete ${preset.name}`}
                className="invisible ml-auto rounded p-0.5 text-sf-muted transition-colors hover:text-sf-primary group-hover:visible"
                onClick={(e) => void handleDelete(preset.id, e)}
              >
                <IconX size={12} />
              </button>
            </div>
          ))}

          {presets.length > 0 && <DropdownMenuSeparator />}

          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sf-primary transition-colors hover:bg-[#1a1a20]"
            onClick={() => {
              setOpen(false);
              setSaveDialogOpen(true);
            }}
          >
            <IconPlus size={14} className="shrink-0" />
            Create new
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={saveDialogOpen}
        onOpenChange={(o) => {
          setSaveDialogOpen(o);
          if (!o) {
            setSaveName('');
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="w-[360px] max-w-[94vw] gap-0 overflow-hidden rounded-[14px] border-sf-border bg-sf-bg p-0 shadow-2xl"
          onPointerDownOutside={() => {
            setSaveDialogOpen(false);
            setSaveName('');
          }}
        >
          <div className="flex items-center justify-between px-6 pt-5">
            <DialogTitle className="text-lg font-semibold tracking-tight text-sf-primary">
              Name this preset
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setSaveDialogOpen(false);
                setSaveName('');
              }}
            >
              <IconX size={14} />
            </Button>
          </div>

          <div className="px-6 py-5">
            <Input
              autoFocus
              placeholder="e.g. Dark Studio"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveName.trim()) {
                  e.preventDefault();
                  void handleConfirmSave();
                }
                if (e.key === 'Escape') {
                  setSaveDialogOpen(false);
                  setSaveName('');
                }
              }}
              className="h-9 border-sf-border bg-sf-panel text-md text-sf-primary placeholder:text-sf-muted"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-sf-border/40 px-6 pb-5 pt-3.5">
            <Button
              variant="outline"
              size="md"
              className="border-sf-border text-sf-secondary hover:text-sf-primary"
              onClick={() => {
                setSaveDialogOpen(false);
                setSaveName('');
              }}
            >
              Cancel
            </Button>
            <Button
              size="md"
              disabled={!saveName.trim() || isSaving}
              onClick={() => void handleConfirmSave()}
            >
              {isSaving && <Spinner className="size-3.5 fill-white text-white/30" />}
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
