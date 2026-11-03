import { Container, Sprite, Graphics, BlurFilter, RenderTexture } from 'pixi.js';
import { useStore } from '../../../store';
import type { PixiEffect, PixiEffectUpdater, PixiScene } from '../../pixi/types';
import type { RenderContext } from '../types';
import type { MaskClip } from '../../../types/timeline';
import { mapSourceTimeToTimelineTime } from '../../helpers/segments';
import { transformPointWithSharedCamera } from '../zoom/index';

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

interface MaskNode {
  container: Container;
  blurSprite: Sprite;
  solidRect: Graphics;
  clipMask: Graphics;
}

export const maskPixiEffect: PixiEffect<null> = {
  id: 'mask',

  analyze() {
    return null;
  },

  setup(_data, _allData, scene: PixiScene): PixiEffectUpdater {
    const root = new Container();
    root.eventMode = 'none';
    scene.overlayContainer.addChild(root);

    // Snapshot of the fully-composited scene (compositeContainer only, no overlay).
    // Reused every frame so blur masks sample the exact rendered pixels behind them
    // rather than the raw unprocessed video frame, which doesn't account for zoom,
    // frame padding, or any other transform applied to the scene.
    let sceneSnapshot: RenderTexture | null = null;

    const nodes = new Map<string, MaskNode>();

    return (t: number, _dt: number, _renderContext: RenderContext) => {
      const state = useStore.getState();
      const timelineTime = mapSourceTimeToTimelineTime(state.mediaSegments, t) ?? t;
      const activeMasks = state.maskClips.filter(
        (m) => timelineTime >= m.start && timelineTime < m.end,
      );

      const cw = scene.app.renderer.width;
      const ch = scene.app.renderer.height;

      // Render compositeContainer to a snapshot texture so blur masks sample
      // the actual rendered scene (with zoom, frame padding, etc.) rather than
      // the raw unprocessed video frame.
      const hasBlurMasks = activeMasks.some((m) => m.type === 'blur');
      if (hasBlurMasks) {
        if (!sceneSnapshot || sceneSnapshot.width !== cw || sceneSnapshot.height !== ch) {
          sceneSnapshot?.destroy(true);
          sceneSnapshot = RenderTexture.create({ width: cw, height: ch });
        }
        scene.app.renderer.render({
          container: scene.compositeContainer,
          target: sceneSnapshot,
          clear: true,
        });
      }

      // Remove nodes for clips no longer in the store
      for (const [id, node] of nodes) {
        if (!state.maskClips.some((m) => m.id === id)) {
          root.removeChild(node.container);
          node.container.destroy({ children: true });
          nodes.delete(id);
        }
      }

      const activeIds = new Set(activeMasks.map((m) => m.id));

      for (const mask of state.maskClips) {
        // Hide inactive masks
        if (!activeIds.has(mask.id)) {
          const node = nodes.get(mask.id);
          if (node) {
            node.container.visible = false;
          }
          continue;
        }

        let node = nodes.get(mask.id);
        if (!node) {
          const container = new Container();
          container.eventMode = 'none';

          const clipMask = new Graphics();
          clipMask.eventMode = 'none';

          const blurSprite = new Sprite();
          blurSprite.eventMode = 'none';
          blurSprite.mask = clipMask;

          const solidRect = new Graphics();
          solidRect.eventMode = 'none';
          solidRect.mask = clipMask;

          container.addChild(clipMask, blurSprite, solidRect);
          root.addChild(container);
          node = { container, blurSprite, solidRect, clipMask };
          nodes.set(mask.id, node);
        }

        node.container.visible = true;
        updateMaskNode(node, mask, cw, ch, sceneSnapshot);
      }
    };
  },
};

function updateMaskNode(
  node: MaskNode,
  mask: MaskClip,
  cw: number,
  ch: number,
  sceneSnapshot: RenderTexture | null,
): void {
  const px = mask.x * cw;
  const py = mask.y * ch;
  const pw = mask.width * cw;
  const ph = mask.height * ch;

  if (pw <= 0 || ph <= 0) {
    node.container.visible = false;
    return;
  }

  // Map the four content-space corners through the current camera transform (zoom +
  // pan + cinematic tilt) so the mask tracks the underlying content rather than
  // staying glued to a fixed canvas pixel position.
  const tl = transformPointWithSharedCamera(px, py);
  const tr = transformPointWithSharedCamera(px + pw, py);
  const br = transformPointWithSharedCamera(px + pw, py + ph);
  const bl = transformPointWithSharedCamera(px, py + ph);

  // Redraw clip mask as a polygon each frame (handles rotation from cinematic zoom)
  node.clipMask.clear();
  node.clipMask.poly([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  node.clipMask.fill(0xffffff);

  if (mask.type === 'blur' && sceneSnapshot) {
    node.blurSprite.visible = true;
    node.solidRect.visible = false;

    // Cover the full canvas 1:1 with the scene snapshot so the blur samples
    // exactly the rendered pixels behind the mask region.
    node.blurSprite.texture = sceneSnapshot;
    node.blurSprite.x = 0;
    node.blurSprite.y = 0;
    node.blurSprite.width = cw;
    node.blurSprite.height = ch;

    // Apply/update blur filter
    const existingFilter = node.blurSprite.filters?.[0];
    if (existingFilter instanceof BlurFilter) {
      existingFilter.strength = mask.blurAmount / 2;
    } else {
      node.blurSprite.filters = [new BlurFilter({ strength: mask.blurAmount / 2, quality: 4 })];
    }
  } else if (mask.type === 'solid') {
    node.blurSprite.visible = false;
    node.solidRect.visible = true;
    node.blurSprite.filters = null;

    node.solidRect.clear();
    node.solidRect.poly([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    node.solidRect.fill({ color: hexToNumber(mask.color), alpha: 1 });
  } else {
    // blur type but no snapshot yet (first frame) — show a dark fallback
    node.blurSprite.visible = false;
    node.solidRect.visible = true;
    node.blurSprite.filters = null;

    node.solidRect.clear();
    node.solidRect.poly([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    node.solidRect.fill({ color: 0x0a0a0f, alpha: 0.9 });
  }
}
