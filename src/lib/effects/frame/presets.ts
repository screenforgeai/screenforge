export interface GradientPreset {
  id: string;
  label: string;
  stops: Array<{ offset: number; color: string }>;
  angle: number;
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  {
    id: 'ocean',
    label: 'Ocean',
    stops: [
      { offset: 0, color: '#0d1b2a' },
      { offset: 1, color: '#1b4332' },
    ],
    angle: 135,
  },
  {
    id: 'sunset',
    label: 'Sunset',
    stops: [
      { offset: 0, color: '#1a1028' },
      { offset: 0.5, color: '#3d1a3d' },
      { offset: 1, color: '#1a2840' },
    ],
    angle: 145,
  },
  {
    id: 'rose',
    label: 'Rose',
    stops: [
      { offset: 0, color: '#1f0a1a' },
      { offset: 1, color: '#2a1028' },
    ],
    angle: 160,
  },
  {
    id: 'aurora',
    label: 'Aurora',
    stops: [
      { offset: 0, color: '#0a1628' },
      { offset: 0.5, color: '#0a2820' },
      { offset: 1, color: '#1e0a28' },
    ],
    angle: 120,
  },
  {
    id: 'ember',
    label: 'Ember',
    stops: [
      { offset: 0, color: '#1a0a05' },
      { offset: 1, color: '#280d0a' },
    ],
    angle: 150,
  },
  {
    id: 'slate',
    label: 'Slate',
    stops: [
      { offset: 0, color: '#0a0f18' },
      { offset: 1, color: '#141e2d' },
    ],
    angle: 135,
  },
  {
    id: 'forest',
    label: 'Forest',
    stops: [
      { offset: 0, color: '#0a1a0f' },
      { offset: 1, color: '#1a2814' },
    ],
    angle: 140,
  },
  {
    id: 'void',
    label: 'Void',
    stops: [
      { offset: 0, color: '#050508' },
      { offset: 1, color: '#0a0a14' },
    ],
    angle: 180,
  },
];

export const SOLID_SWATCHES = [
  '#0f0f14',
  '#0a0f1e',
  '#0f1a0f',
  '#1a0f0f',
  '#1a1128',
  '#111111',
  '#0d1117',
  '#0e1016',
  '#1a1200',
  '#081515',
  '#1f0a2a',
  '#0d0d0d',
];
