import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import {
  IconBuilding,
  IconChevronDown,
  IconCopy,
  IconLayers,
  IconPlus,
  IconX,
} from 'src/lib/icons';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from 'src/lib/ui';
import { getCustomWallpaperUrl, setCustomWallpaperUrl } from 'src/lib/effects/frame/wallpapers';
import { BRAND_FONT_FAMILIES } from 'src/lib/fonts';
import { presetDraftFromState, stylePresetPatch } from 'src/lib/presets/style-preset';
import { useStore } from '../../../store';
import type { StylePreset, StylePresetAssets } from '../../../types';

/** Select needs a non-empty value for "don't set a font". */
const KEEP_FONTS = 'keep';

const FONT_OPTIONS = [
  { value: KEEP_FONTS, labelKey: 'presets_fontKeep' },
  { value: BRAND_FONT_FAMILIES.sans, labelKey: 'presets_fontSans' },
  { value: BRAND_FONT_FAMILIES.serif, labelKey: 'presets_fontSerif' },
  { value: BRAND_FONT_FAMILIES.system, labelKey: 'presets_fontSystem' },
] as const;

const NO_ASSETS: StylePresetAssets = { logoDataUrl: null, customWallpaperDataUrl: null };

type SaveDialog = { mode: 'create' } | { mode: 'duplicate'; preset: StylePreset };

const isWorkspacePreset = (preset: StylePreset) => preset.source === 'director';

export const StylesDropdown = () => {
  const { t } = useTranslation('topnav');
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<SaveDialog | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveFont, setSaveFont] = useState<string>(KEEP_FONTS);
  const [isSaving, setIsSaving] = useState(false);
  const [presets, setPresets] = useState<StylePreset[]>([]);

  const { recordingResult, commitEdit } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      commitEdit: state.commitEdit,
    })),
  );

  const loadPresets = useCallback(() => {
    void window.screenforge
      .getPresets()
      .then(setPresets)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadPresets();
    // The brand kit syncs in the background; show its latest copy.
    return window.screenforge.onPresetsChanged(loadPresets);
  }, [loadPresets]);

  if (!recordingResult) {
    return null;
  }

  const displayName = (preset: StylePreset) =>
    isWorkspacePreset(preset) ? t('presets_brandKit') : preset.name;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void window.screenforge.refreshBrandKit().catch(() => undefined);
    }
  };

  const handleApply = async (preset: StylePreset) => {
    setOpen(false);
    let assets = NO_ASSETS;
    let assetsMissing = false;
    if (preset.logo || preset.customWallpaperPath) {
      assets = await window.screenforge.getPresetAssets(preset.id).catch(() => NO_ASSETS);
      assetsMissing =
        (Boolean(preset.logo) && !assets.logoDataUrl) ||
        (Boolean(preset.customWallpaperPath) && !assets.customWallpaperDataUrl);
    }
    if (assets.customWallpaperDataUrl) {
      setCustomWallpaperUrl(assets.customWallpaperDataUrl);
    }
    commitEdit('Apply style preset', (state) => stylePresetPatch(state, preset, assets));
    if (assetsMissing) {
      toast.warning(t('presets_appliedWithoutImages', { name: displayName(preset) }));
    } else {
      toast.success(t('presets_applied', { name: displayName(preset) }));
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.screenforge.deletePreset(id);
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  const openDialog = (next: SaveDialog) => {
    setOpen(false);
    setSaveName(next.mode === 'duplicate' ? t('presets_copyName', { name: next.preset.name }) : '');
    setSaveFont(KEEP_FONTS);
    setDialog(next);
  };

  const closeDialog = () => {
    setDialog(null);
    setSaveName('');
  };

  const handleConfirmSave = async () => {
    const name = saveName.trim();
    if (!name || !dialog) {
      return;
    }
    setIsSaving(true);
    try {
      const saved =
        dialog.mode === 'duplicate'
          ? await window.screenforge.duplicatePreset(dialog.preset.id, name)
          : await window.screenforge.savePreset(
              presetDraftFromState(useStore.getState(), {
                name,
                font: saveFont === KEEP_FONTS ? null : saveFont,
                customWallpaperDataUrl: getCustomWallpaperUrl(),
              }),
            );
      setPresets((prev) => [...prev, saved]);
      closeDialog();
      toast.success(t('presets_saved', { name }));
    } catch {
      toast.error(t('presets_saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-sf-border bg-transparent px-2 py-0 text-sm font-medium tracking-[-0.01em] text-sf-secondary transition-[border-color,color,background-color,box-shadow,transform] duration-150 ease-out hover:border-sf-border-lt hover:bg-sf-panel/70 hover:text-sf-primary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-0 data-[state=open]:border-sf-border-lt data-[state=open]:bg-sf-panel data-[state=open]:text-sf-primary data-[state=open]:shadow-[0_1px_1px_rgba(0,0,0,0.12),0_10px_24px_rgba(0,0,0,0.18)]"
          >
            <IconLayers size={14} className="shrink-0 text-sf-secondary" />
            <span className="text-sf-secondary">{t('presets_menu')}</span>
            <IconChevronDown
              size={14}
              className="shrink-0 text-sf-muted transition-transform duration-200 ease-out group-data-[state=open]:rotate-180"
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          {presets.map((preset) => {
            const name = displayName(preset);
            const workspace = isWorkspacePreset(preset);
            return (
              <DropdownMenuItem
                key={preset.id}
                className="group gap-2 px-2.5 text-sm"
                title={workspace ? t('presets_brandKitHint') : undefined}
                onSelect={() => void handleApply(preset)}
              >
                {workspace && <IconBuilding size={14} className="text-sf-muted" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{name}</span>
                  {workspace && (
                    <span className="truncate text-xs text-sf-muted">{preset.name}</span>
                  )}
                </span>
                {workspace ? (
                  <button
                    type="button"
                    aria-label={t('presets_saveAsNew', { name })}
                    title={t('presets_saveAsNew', { name })}
                    className="invisible ml-auto rounded p-0.5 text-sf-muted transition-colors hover:text-sf-primary group-hover:visible group-focus:visible"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDialog({ mode: 'duplicate', preset });
                    }}
                  >
                    <IconCopy size={12} />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t('presets_delete', { name })}
                    className="invisible ml-auto rounded p-0.5 text-sf-muted transition-colors hover:text-sf-primary group-hover:visible group-focus:visible"
                    onClick={(e) => void handleDelete(preset.id, e)}
                  >
                    <IconX size={12} />
                  </button>
                )}
              </DropdownMenuItem>
            );
          })}

          {presets.length > 0 && <DropdownMenuSeparator />}

          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sf-primary transition-colors hover:bg-sf-panel"
            onClick={() => openDialog({ mode: 'create' })}
          >
            <IconPlus size={14} className="shrink-0" />
            {t('presets_createNew')}
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) {
            closeDialog();
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="w-[360px] max-w-[94vw] gap-0 overflow-hidden rounded-[14px] border-sf-border bg-sf-bg p-0 shadow-2xl"
          onPointerDownOutside={closeDialog}
        >
          <div className="flex items-center justify-between px-6 pt-5">
            <DialogTitle className="text-lg font-semibold tracking-tight text-sf-primary">
              {t('presets_nameTitle')}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('presets_cancel')}
              onClick={closeDialog}
            >
              <IconX size={14} />
            </Button>
          </div>

          <div className="flex flex-col gap-3 px-6 py-5">
            <Input
              autoFocus
              placeholder={t('presets_namePlaceholder')}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveName.trim()) {
                  e.preventDefault();
                  void handleConfirmSave();
                }
                if (e.key === 'Escape') {
                  closeDialog();
                }
              }}
              className="h-9 border-sf-border bg-sf-panel text-md text-sf-primary placeholder:text-sf-muted"
            />
            {dialog?.mode === 'create' && (
              <Select value={saveFont} onValueChange={setSaveFont}>
                <SelectTrigger aria-label={t('presets_font')} className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-sf-border/40 px-6 pb-5 pt-3.5">
            <Button
              variant="outline"
              size="md"
              className="border-sf-border text-sf-secondary hover:text-sf-primary"
              onClick={closeDialog}
            >
              {t('presets_cancel')}
            </Button>
            <Button
              size="md"
              disabled={!saveName.trim() || isSaving}
              onClick={() => void handleConfirmSave()}
            >
              {isSaving && <Spinner className="size-3.5 fill-white text-white/30" />}
              {isSaving ? t('saving') : t('save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
