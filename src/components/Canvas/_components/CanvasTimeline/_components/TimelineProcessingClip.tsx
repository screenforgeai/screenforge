import { motion } from 'motion/react';
import { LANE_H, SCALE } from '../constants';

const TIMELINE_START_LEFT = 20;

interface TimelineProcessingClipProps {
  timelineStart: number;
  timelineEnd: number;
  scaleWidth: number;
  scrollLeft: number;
  rowTop: number;
}

export const TimelineProcessingClip = ({
  timelineStart,
  timelineEnd,
  scaleWidth,
  scrollLeft,
  rowTop,
}: TimelineProcessingClipProps) => {
  const left = TIMELINE_START_LEFT + (timelineStart / SCALE) * scaleWidth - scrollLeft;
  const width = ((timelineEnd - timelineStart) / SCALE) * scaleWidth;

  if (width <= 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 2 }}>
      <motion.div
        initial={{ opacity: 0, scaleX: 0.96 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="absolute overflow-hidden rounded-lg"
        style={{
          left,
          top: rowTop,
          width,
          height: LANE_H,
          background: '#0f2540',
          border: '1px solid #1e5080',
          transformOrigin: 'left center',
        }}
      >
        {/* Diagonal stripe texture — matches ActionClip */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, transparent 0px, transparent 7px, rgba(255,255,255,0.02) 7px, rgba(255,255,255,0.02) 8px)',
          }}
        />
        {/* Top highlight line — matches ActionClip */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{ height: 1, background: 'rgba(255,255,255,0.08)' }}
        />
        <div className="sf-shimmer absolute inset-0" />
        <div className="absolute inset-0 flex items-center gap-1.5 pl-2.5 pr-2 select-none">
          <div
            className="shrink-0 animate-spin rounded-full"
            style={{
              width: 14,
              height: 14,
              border: '1.5px solid rgba(96, 165, 250, 0.25)',
              borderTopColor: '#60a5fa',
            }}
          />
          <span
            className="flex-1 truncate text-sm font-medium"
            style={{ color: '#dbeafe', letterSpacing: '0.3px' }}
          >
            Processing…
          </span>
        </div>
      </motion.div>
    </div>
  );
};
