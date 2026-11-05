import type { TimelineAction } from '@xzdarcy/timeline-engine';

export const DEFAULT_DUR = 60;
export const SCALE = 5;
export const GUTTER_W = 140;
export const LANE_H = 44;
export const TOOLBAR_H = 38;
export const RULER_H = 42;

export const GHOST_WIDTH = 56;

export const SCALE_STEP = 20;
export const SCALE_MIN = 40;
export const SCALE_MAX = 200;

export const TL_H_DEFAULT = TOOLBAR_H + RULER_H + LANE_H * 8 + 120;
export const TL_H_MIN = TOOLBAR_H + RULER_H + LANE_H * 8;
export const TL_H_MAX = 560;

export const EFFECTS = {
  video: { id: 'video', name: 'Video' },
  audio: { id: 'audio', name: 'Audio' },
  zoom: { id: 'zoom', name: 'Zoom' },
  motion: { id: 'motion', name: 'Motion' },
  camera: { id: 'camera', name: 'Camera' },
  mask: { id: 'mask', name: 'Mask' },
  text: { id: 'text', name: 'Text' },
  music: { id: 'music', name: 'Music' },
};

export interface Layer {
  id: string;
  label: string;
  hidden: boolean;
  actions: TimelineAction[];
}

export const INITIAL_LAYERS: Layer[] = [
  {
    id: 'indicators',
    label: 'Markers',
    hidden: false,
    actions: [],
  },
  {
    id: 'video',
    label: 'Video',
    hidden: false,
    actions: [
      {
        id: 'video-clip',
        start: 0,
        end: DEFAULT_DUR,
        effectId: 'video',
        flexible: false,
        movable: false,
      },
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    hidden: false,
    actions: [],
  },
  {
    id: 'motion',
    label: 'Motion',
    hidden: false,
    actions: [],
  },
  {
    id: 'zoom',
    label: 'Zoom',
    hidden: false,
    actions: [],
  },
  {
    id: 'camera',
    label: 'Camera',
    hidden: false,
    actions: [],
  },
  {
    id: 'mask',
    label: 'Mask',
    hidden: false,
    actions: [],
  },
  {
    id: 'text',
    label: 'Text',
    hidden: false,
    actions: [],
  },
  {
    id: 'music',
    label: 'Music',
    hidden: false,
    actions: [],
  },
];
