// A backdrop blur over the video preview is recomputed by the compositor on every
// playback frame, because what it blurs changes every frame. Chips and labels over
// the preview use a solid translucent background instead.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src/components/Canvas/_components');
const OVER_PREVIEW = [
  'CanvasPreview.tsx',
  'CameraOverlayEditor.tsx',
  'MaskOverlayEditor.tsx',
  'TextOverlayEditor.tsx',
];

describe('overlays on the video preview', () => {
  it('lists files that exist, so a rename cannot silently skip the check', () => {
    const files = readdirSync(DIR);
    for (const file of OVER_PREVIEW) {
      expect(files).toContain(file);
    }
  });

  it.each(OVER_PREVIEW)('%s puts no backdrop blur over the preview', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    expect(source).not.toMatch(/backdrop-blur|backdrop-filter|backdropFilter/);
  });
});
