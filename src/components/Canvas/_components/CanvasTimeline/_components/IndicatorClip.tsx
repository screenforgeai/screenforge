import { IconKeyboard, IconPointer } from '../../../../../lib/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../../lib/ui';
import type { ComponentType, MouseEvent as ReactMouseEvent } from 'react';
import type { TimelineIndicatorKind } from '../../../../../types/timeline';

interface KindStyle {
  bg: string;
  border: string;
  text: string;
  iconColor: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Icon: ComponentType<any>;
}

const KIND_STYLES: Record<TimelineIndicatorKind, KindStyle> = {
  'keyboard-shortcut': {
    bg: 'rgba(8, 8, 10, 0.45)',
    border: 'rgba(255, 255, 255, 0.18)',
    text: 'rgba(255, 255, 255, 0.55)',
    iconColor: 'rgba(255, 255, 255, 0.4)',
    Icon: IconKeyboard,
  },
  'mouse-click': {
    bg: 'rgba(8, 8, 10, 0.45)',
    border: 'rgba(255, 255, 255, 0.18)',
    text: 'rgba(255, 255, 255, 0.55)',
    iconColor: 'rgba(255, 255, 255, 0.4)',
    Icon: IconPointer,
  },
};

const MIN_WIDTH = 44;

interface Props {
  kind: TimelineIndicatorKind;
  /** Display label */
  label: string;
  /** Detail shown on hover */
  tooltip?: string;
  /** Left offset in px (scrollLeft already subtracted) */
  x: number;
  /** Width in px from event duration; clamped to MIN_WIDTH */
  width: number;
  /** When true, show both keyboard + click icons side-by-side (mixed group) */
  mixed?: boolean;
  onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
}

export const IndicatorClip = ({
  kind,
  label,
  tooltip,
  x,
  width,
  mixed = false,
  onClick,
}: Props) => {
  const s = KIND_STYLES[kind];
  const w = Math.max(MIN_WIDTH, width);
  const tooltipText = tooltip ?? label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          onClick={onClick}
          style={{
            position: 'absolute',
            left: x,
            width: w,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 34,
            pointerEvents: 'auto',
          }}
        >
          <div
            className="flex h-full w-full items-center gap-1 overflow-hidden rounded px-1.5"
            style={{
              background: s.bg,
              border: `1px dashed ${s.border}`,
              borderRadius: 6,
            }}
          >
            {mixed ? (
              <>
                <IconKeyboard size={12} stroke={2} style={{ color: s.iconColor, flexShrink: 0 }} />
                <IconPointer
                  size={12}
                  stroke={2}
                  style={{ color: s.iconColor, flexShrink: 0, opacity: 0.7 }}
                />
              </>
            ) : (
              <s.Icon size={12} stroke={2} style={{ color: s.iconColor, flexShrink: 0 }} />
            )}
            <span
              className="truncate text-xs font-semibold leading-none"
              style={{ color: s.text, letterSpacing: '0.3px' }}
            >
              {label}
            </span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="whitespace-pre-line">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  );
};
