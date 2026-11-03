import { ASPECT_RATIO_PRESETS, type AspectRatioPreset } from 'src/lib/effects/frame/analyze';
import { trackEvent } from 'src/lib/analytics';
import { Select, SelectContent, SelectItem, SelectTrigger } from 'src/lib/ui';
import { useStore } from '../../../store';
import { useShallow } from 'zustand/react/shallow';
import { getInitialPlaybackTime } from 'src/lib/helpers/segments';

const DISPLAY_NAMES: Record<string, string> = {
  original: 'Auto',
  '16:9': 'Widescreen',
  '9:16': 'Story',
  '1:1': 'Square',
  '4:5': 'Portrait',
  '4:3': 'Landscape',
};

const BOX = 14;

const RatioIcon = ({ preset, className }: { preset: AspectRatioPreset; className?: string }) => {
  if (!preset.width || !preset.height) {
    return (
      <svg
        width={BOX}
        height={BOX}
        viewBox="0 0 14 14"
        fill="none"
        className={className}
        aria-hidden
      >
        <rect
          x="0.75"
          y="0.75"
          width="12.5"
          height="12.5"
          rx="1.75"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <line x1="0.75" y1="4.92" x2="13.25" y2="4.92" stroke="currentColor" strokeWidth="1.1" />
        <line x1="4.92" y1="0.75" x2="4.92" y2="13.25" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  }

  const ratio = preset.width / preset.height;
  let w: number, h: number;
  if (ratio >= 1) {
    w = BOX;
    h = Math.max(5, Math.round(BOX / ratio));
  } else {
    h = BOX;
    w = Math.max(5, Math.round(BOX * ratio));
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      style={{ minWidth: w }}
      className={className}
      aria-hidden
    >
      <rect
        x="0.75"
        y="0.75"
        width={w - 1.5}
        height={h - 1.5}
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
};

export const CanvasRatioDropdown = () => {
  const { frame, recordingResult, mediaSegments, commitEdit, requestPauseAndSeekTo } = useStore(
    useShallow((state) => ({
      frame: state.frame,
      recordingResult: state.recordingResult,
      mediaSegments: state.mediaSegments,
      commitEdit: state.commitEdit,
      requestPauseAndSeekTo: state.requestPauseAndSeekTo,
    })),
  );

  if (!recordingResult) {
    return null;
  }

  const selectedPreset =
    ASPECT_RATIO_PRESETS.find((p) => p.id === frame.aspectRatioId) ?? ASPECT_RATIO_PRESETS[0];

  const handleChange = (value: string) => {
    trackEvent('widget_config_changed', { widget: 'frame', property: 'aspectRatioId', value });
    requestPauseAndSeekTo(getInitialPlaybackTime(mediaSegments));
    commitEdit('Change aspect ratio', (state) => ({
      frame: { ...state.frame, aspectRatioId: value },
    }));
  };

  return (
    <Select value={frame.aspectRatioId} onValueChange={handleChange}>
      <SelectTrigger className="h-8 w-auto gap-1.5 border-sf-border bg-transparent px-2 py-0 text-sm text-sf-secondary hover:border-sf-border-lt hover:text-sf-primary focus-visible:ring-0 [&_svg[data-slot=select-icon]]:text-sf-muted">
        <RatioIcon preset={selectedPreset} className="shrink-0 text-sf-secondary" />
        <span className="text-sm text-sf-secondary">
          {selectedPreset.id === 'original' ? 'Auto' : selectedPreset.id}
        </span>
      </SelectTrigger>

      <SelectContent className="min-w-[180px]" align="end">
        {ASPECT_RATIO_PRESETS.map((preset) => (
          <SelectItem key={preset.id} value={preset.id}>
            <div className="flex w-full items-center gap-2.5">
              <span className="flex w-[14px] items-center justify-center text-sf-secondary">
                <RatioIcon preset={preset} />
              </span>
              <span className="font-medium text-sf-primary">
                {DISPLAY_NAMES[preset.id] ?? preset.label}
              </span>
              {preset.width && preset.height && (
                <span className="ml-auto pl-4 text-xs text-sf-muted">{preset.id}</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
