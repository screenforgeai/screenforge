import { describe, expect, it, vi } from 'vitest';
import { createExportPixiApp, createPreviewPixiApp } from './createPixiApp';

const inits = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('pixi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    stage = new actual.Container();
    renderer = { type: 1 };
    async init(options: Record<string, unknown>) {
      inits.push(options);
    }
  }
  return { ...actual, Application: FakeApplication };
});

describe('Pixi apps', () => {
  it('antialias the preview and the export, so rounded corners, rings and shapes are smooth', async () => {
    await createPreviewPixiApp(document.createElement('canvas'));
    await createExportPixiApp(1920, 1080);

    expect(inits).toHaveLength(2);
    for (const options of inits) {
      expect(options.antialias).toBe(true);
    }
  });
});
