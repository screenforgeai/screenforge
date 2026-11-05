import { IconPlus } from 'src/lib/icons';
import { GHOST_WIDTH, LANE_H } from '../constants';

type GhostLane = 'video' | 'zoom' | 'text' | 'music' | 'mask' | 'motion';

interface TimelineGhostZoneProps {
  x: number;
  rowTop: number;
  lane: GhostLane;
}

const LANE_COLOR: Record<GhostLane, string> = {
  video: 'rgba(15, 37, 64, 0.55)',
  zoom: 'rgba(8, 130, 160, 0.18)',
  text: 'rgba(212, 69, 35, 0.18)',
  music: 'rgba(38, 24, 0, 0.55)',
  mask: 'rgba(17, 30, 46, 0.55)',
  motion: 'rgba(27, 30, 68, 0.55)',
};

const LANE_BORDER: Record<GhostLane, string> = {
  video: 'rgba(30, 80, 128, 0.6)',
  zoom: 'rgba(20, 180, 210, 0.25)',
  text: 'rgba(212, 69, 35, 0.35)',
  music: 'rgba(180, 83, 9, 0.55)',
  mask: 'rgba(45, 96, 128, 0.6)',
  motion: 'rgba(99, 102, 241, 0.55)',
};

const LANE_ICON: Record<GhostLane, string> = {
  video: 'rgba(100, 180, 255, 0.75)',
  zoom: 'rgba(40, 210, 240, 0.7)',
  text: 'rgba(240, 120, 80, 0.7)',
  music: 'rgba(245, 158, 11, 0.8)',
  mask: 'rgba(147, 197, 211, 0.8)',
  motion: 'rgba(165, 180, 252, 0.8)',
};

// Fully pointer-events-none so mouse events always reach the parent div.
// Clicks are handled via onClickCapture on the parent in CanvasTimeline.
export const TimelineGhostZone = ({ x, rowTop, lane }: TimelineGhostZoneProps) => {
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 2 }}>
      <div
        className="pointer-events-none absolute flex items-center justify-center rounded-md border border-dashed"
        style={{
          left: x - GHOST_WIDTH / 2,
          top: rowTop + 4,
          width: GHOST_WIDTH,
          height: LANE_H - 8,
          backgroundColor: LANE_COLOR[lane],
          borderColor: LANE_BORDER[lane],
        }}
      >
        <IconPlus size={14} color={LANE_ICON[lane]} />
      </div>
    </div>
  );
};
