import {
  IconAiMagic,
  IconBlur,
  IconMicrophone,
  IconMotion,
  IconMusicNote,
  IconText,
  IconTimer,
  IconVideo,
  IconZoom,
} from 'src/lib/icons';
import type { TimelineAction } from '@xzdarcy/timeline-engine';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../../../../lib/ui';
import { AudioWaveform } from './AudioWaveform';

interface AudioWaveformData {
  audioSrc: string;
  sourceStart: number;
  sourceEnd: number;
}

interface Props {
  action: TimelineAction;
  onDelete: (action: Pick<TimelineAction, 'id' | 'effectId'>) => void;
  onSelect: (action: TimelineAction) => void;
  onFitToVideo?: (action: TimelineAction) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void;
  onContextMenuOpenChange?: (open: boolean) => void;
  selected: boolean;
  multiSelected?: boolean;
  audioWaveform?: AudioWaveformData;
  speed?: number;
}

export const ActionClip = ({
  action,
  onDelete,
  onSelect,
  onFitToVideo,
  onPointerDown,
  onPointerLeave,
  onContextMenuOpenChange,
  selected,
  multiSelected,
  audioWaveform,
  speed,
}: Props) => {
  const isVideo = action.effectId === 'video';
  const isAudio = action.effectId === 'audio';
  const isCamera = action.effectId === 'camera';
  const isText = action.effectId === 'text';
  const isMusic = action.effectId === 'music';
  const isMask = action.effectId === 'mask';
  const isMotion = action.effectId === 'motion';
  const isCinematicZoom =
    action.effectId === 'zoom' && (action as { preset?: string }).preset === 'cinematic';

  const isHighlighted = selected || Boolean(multiSelected);

  const clipTone = isVideo
    ? {
        background: isHighlighted ? '#1a3a5c' : '#0f2540',
        border: isHighlighted ? '#4a90d9' : '#1e5080',
        glow: '0 0 0 2px rgba(74,144,217,0.25)',
        multiGlow: '0 0 0 2px rgba(74,144,217,0.45)',
      }
    : isAudio
      ? {
          background: isHighlighted ? '#134e4a' : '#0d3d39',
          border: isHighlighted ? '#2dd4bf' : '#14b8a6',
          glow: '0 0 0 2px rgba(45,212,191,0.25)',
          multiGlow: '0 0 0 2px rgba(45,212,191,0.45)',
        }
      : isMusic
        ? {
            background: isHighlighted ? '#3d2600' : '#261800',
            border: isHighlighted ? '#f59e0b' : '#b45309',
            glow: '0 0 0 2px rgba(245,158,11,0.25)',
            multiGlow: '0 0 0 2px rgba(245,158,11,0.45)',
          }
        : isCamera
          ? {
              background: isHighlighted ? '#5b2a8a' : '#3f1c66',
              border: isHighlighted ? '#d8b4fe' : '#a855f7',
              glow: '0 0 0 2px rgba(216,180,254,0.3)',
              multiGlow: '0 0 0 2px rgba(216,180,254,0.5)',
            }
          : isText
            ? {
                background: isHighlighted ? '#7c2310' : '#5a1a0d',
                border: isHighlighted ? '#f97316' : '#d44523',
                glow: '0 0 0 2px rgba(212,69,35,0.3)',
                multiGlow: '0 0 0 2px rgba(212,69,35,0.5)',
              }
            : isMask
              ? {
                  background: isHighlighted ? '#1c3045' : '#111e2e',
                  border: isHighlighted ? '#5b9abf' : '#2d6080',
                  glow: '0 0 0 2px rgba(91,154,191,0.3)',
                  multiGlow: '0 0 0 2px rgba(91,154,191,0.5)',
                }
              : isMotion
                ? {
                    background: isHighlighted ? '#262a5c' : '#1b1e44',
                    border: isHighlighted ? '#a5b4fc' : '#6366f1',
                    glow: '0 0 0 2px rgba(165,180,252,0.3)',
                    multiGlow: '0 0 0 2px rgba(165,180,252,0.5)',
                  }
                : isCinematicZoom
                  ? {
                      background: isHighlighted ? '#312255' : '#21183f',
                      border: isHighlighted ? '#c4b5fd' : '#8b5cf6',
                      glow: '0 0 0 2px rgba(139,92,246,0.3)',
                      multiGlow: '0 0 0 2px rgba(196,181,253,0.45)',
                    }
                  : {
                      background: isHighlighted ? '#0891b2' : '#0e7490',
                      border: isHighlighted ? '#67e8f9' : '#22d3ee',
                      glow: '0 0 0 2px rgba(103,232,249,0.3)',
                      multiGlow: '0 0 0 2px rgba(103,232,249,0.5)',
                    };

  const boxShadow = multiSelected ? clipTone.multiGlow : isHighlighted ? clipTone.glow : undefined;

  return (
    <ContextMenu onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          onContextMenu={() => onSelect(action)}
          onPointerDown={onPointerDown}
          onPointerLeave={onPointerLeave}
          className="group relative flex h-full w-full cursor-default items-center gap-1.5 overflow-hidden rounded-lg pl-2.5 pr-2"
          style={{
            background: clipTone.background,
            border: `1px solid ${clipTone.border}`,
            boxShadow,
          }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'repeating-linear-gradient(-45deg, transparent 0px, transparent 7px, rgba(255,255,255,0.02) 7px, rgba(255,255,255,0.02) 8px)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{ height: 1, background: 'rgba(255,255,255,0.08)' }}
          />
          {isAudio && audioWaveform && (
            <AudioWaveform
              audioSrc={audioWaveform.audioSrc}
              sourceStart={audioWaveform.sourceStart}
              sourceEnd={audioWaveform.sourceEnd}
              selected={selected}
            />
          )}

          {/* Trim handle indicators */}
          {isVideo && (
            <div
              className="pointer-events-none absolute inset-y-1.5 left-0 w-[5px] rounded-full"
              style={{
                background: 'rgba(100,180,255,0.55)',
                boxShadow: '0 0 0 1px rgba(30,80,128,0.6)',
              }}
            />
          )}
          {isVideo && (
            <div
              className="pointer-events-none absolute inset-y-1.5 right-0 w-[5px] rounded-full"
              style={{
                background: 'rgba(100,180,255,0.55)',
                boxShadow: '0 0 0 1px rgba(30,80,128,0.6)',
              }}
            />
          )}

          {isMusic ? (
            <>
              <IconMusicNote
                size={14}
                style={{
                  color: '#fcd34d',
                  opacity: 0.9,
                  position: 'relative',
                  zIndex: 2,
                  flexShrink: 0,
                }}
              />
              <span
                className="relative z-10 flex-1 truncate text-sm font-medium"
                style={{ color: '#fef3c7', letterSpacing: '0.3px' }}
              >
                {(action as { label?: string }).label ?? 'Music'}
              </span>
            </>
          ) : (
            <>
              {isVideo || isCamera ? (
                <IconVideo
                  size={14}
                  style={{
                    color: isCamera ? '#e9d5ff' : '#60a5fa',
                    opacity: isCamera ? 0.95 : 0.88,
                    position: 'relative',
                    zIndex: 2,
                    flexShrink: 0,
                  }}
                />
              ) : isAudio ? (
                <IconMicrophone
                  size={14}
                  style={{
                    color: '#2dd4bf',
                    opacity: 0.92,
                    position: 'relative',
                    zIndex: 2,
                    flexShrink: 0,
                  }}
                />
              ) : isText ? (
                <IconText
                  size={14}
                  style={{
                    color: '#fed7aa',
                    opacity: 0.92,
                    position: 'relative',
                    zIndex: 2,
                    flexShrink: 0,
                  }}
                />
              ) : isMask ? (
                <IconBlur
                  size={14}
                  style={{
                    color: '#93c5d3',
                    opacity: 0.92,
                    position: 'relative',
                    zIndex: 2,
                    flexShrink: 0,
                  }}
                />
              ) : isMotion ? (
                <IconMotion
                  size={14}
                  style={{
                    color: '#c7d2fe',
                    opacity: 0.92,
                    position: 'relative',
                    zIndex: 2,
                    flexShrink: 0,
                  }}
                />
              ) : isCinematicZoom ? (
                <IconAiMagic
                  size={14}
                  style={{
                    color: '#ddd6fe',
                    opacity: 0.95,
                    position: 'relative',
                    zIndex: 2,
                    flexShrink: 0,
                  }}
                />
              ) : (
                <IconZoom
                  size={14}
                  style={{ opacity: 1, position: 'relative', zIndex: 2, flexShrink: 0 }}
                />
              )}

              <span
                className="relative z-10 flex-1 truncate text-sm font-medium"
                style={{
                  letterSpacing: '0.3px',
                  color: isVideo
                    ? '#dbeafe'
                    : isAudio
                      ? '#ccfbf1'
                      : isCamera
                        ? '#f3e8ff'
                        : isText
                          ? '#fed7aa'
                          : isMask
                            ? '#bae6fd'
                            : isMotion
                              ? '#e0e7ff'
                              : isCinematicZoom
                                ? '#ede9fe'
                                : '#ecfeff',
                }}
              >
                {isVideo
                  ? 'Video'
                  : isAudio
                    ? 'Audio'
                    : isCamera
                      ? 'Camera'
                      : isText
                        ? (action as { content?: string }).content?.slice(0, 25) || 'Text'
                        : isMask
                          ? 'Mask'
                          : isMotion
                            ? ((action as { label?: string }).label ?? 'Motion')
                            : isCinematicZoom
                              ? 'Cinematic'
                              : 'Zoom'}
              </span>
              {(isVideo || isAudio || isCamera) && speed !== undefined && speed !== 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="relative z-10 ml-auto shrink-0 pr-2 flex items-center">
                      <IconTimer
                        size={13}
                        style={{
                          color: isAudio
                            ? 'rgba(45,212,191,0.42)'
                            : isCamera
                              ? 'rgba(216,180,254,0.42)'
                              : 'rgba(219,234,254,0.42)',
                        }}
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {speed && speed !== 1 ? `${speed}× speed` : 'Normal speed'}
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {isMusic && onFitToVideo && (
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onFitToVideo(action);
            }}
          >
            Fit to video
          </ContextMenuItem>
        )}
        <ContextMenuItem
          className="text-red-300 focus:bg-red-500/15 focus:text-red-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete({ id: action.id, effectId: action.effectId });
          }}
        >
          Delete
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
