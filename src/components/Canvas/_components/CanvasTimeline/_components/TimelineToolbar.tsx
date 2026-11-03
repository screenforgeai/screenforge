import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerStopFilled,
  IconScissors,
  IconZoomIn,
  IconZoomOut,
} from 'src/lib/icons';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '../../../../../lib/ui';
import { formatTime } from '../../../../../lib/utils';
import { TOOLBAR_H, SCALE_MIN, SCALE_MAX } from '../constants';

interface Props {
  playing: boolean;
  currentTime: number;
  totalDur: number;
  scaleWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  onSplit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export const TimelineToolbar = ({
  playing,
  currentTime,
  totalDur,
  scaleWidth,
  canUndo,
  canRedo,
  onTogglePlay,
  onStop,
  onSplit,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
}: Props) => {
  const { t } = useTranslation('timeline');
  const preventMouseFocus = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <div
      className="flex shrink-0 items-center border-b border-sf-border bg-sf-panel px-3"
      style={{ height: TOOLBAR_H }}
    >
      <div className="mr-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onMouseDown={preventMouseFocus}
              onClick={onUndo}
              disabled={!canUndo}
            >
              <IconArrowBackUp size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('undo')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onMouseDown={preventMouseFocus}
              onClick={onRedo}
              disabled={!canRedo}
            >
              <IconArrowForwardUp size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('redo')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onMouseDown={preventMouseFocus}
              onClick={onSplit}
            >
              <IconScissors size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('split')}</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onMouseDown={preventMouseFocus}
              onClick={onTogglePlay}
            >
              {playing ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{playing ? t('pause') : t('play')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onMouseDown={preventMouseFocus} onClick={onStop}>
              <IconPlayerStopFilled size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('stop')}</TooltipContent>
        </Tooltip>

        <span
          className="font-mono tabular-nums ml-2 text-sm text-sf-secondary"
          style={{ letterSpacing: '0.04em' }}
        >
          <span style={{ color: 'var(--color-primary)' }}>{formatTime(currentTime)}</span>
          {' / '}
          {formatTime(totalDur)}
        </span>
      </div>

      <div className="flex-1 flex items-center justify-end gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onMouseDown={preventMouseFocus}
              onClick={onZoomOut}
              active={scaleWidth <= SCALE_MIN}
            >
              <IconZoomOut size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('zoomOut')}</TooltipContent>
        </Tooltip>
        <div className="text-sm font-mono tabular-nums w-8 text-center text-sf-secondary">
          {Math.round((scaleWidth / 80) * 100)}%
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onMouseDown={preventMouseFocus}
              onClick={onZoomIn}
              active={scaleWidth >= SCALE_MAX}
            >
              <IconZoomIn size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('zoomIn')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
