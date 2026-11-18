/**
 * Smooth edges without canvas MSAA (PixiScene.edgeSmoothing === 'shader').
 *
 * Canvas MSAA costs ~4 ms a 1080p export frame. Without it, stencil masks and
 * Graphics shapes have stepped edges, so effects smooth their own:
 *
 * - The frame's rounded corners (the largest edge on screen) are cut by a
 *   shader that computes each pixel's coverage of the rounded rectangles, so
 *   the edge fades over one pixel at any zoom, pan or tilt.
 * - Small shapes (camera bubble, cursor lens and ripples, pills, redaction
 *   boxes) render into an MSAA texture of their own bounds
 *   (`createLocalMsaaFilter`), so they look as before at a cost proportional
 *   to their size.
 *
 * Full-frame filters (zoom sharpen, tilt, cinematic) inherit the canvas's
 * antialiasing; without it they cost less, and they warp in the fragment
 * shader, where MSAA never smoothed anything.
 */
import { AlphaFilter, Container, Filter, GlProgram, Matrix, UniformGroup } from 'pixi.js';

/** A rounded rectangle in the clipped container's local coordinates. */
export interface RoundedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

// Both start with the ES 3.00 directive: without it Pixi compiles GLSL ES 1.0,
// which has no fwidth.
const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vGlobal;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec4 uGlobalFrame;

void main(void)
{
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  // World position: Pixi offsets a filter nested in another filter's texture
  // by that texture's origin (uGlobalFrame.xy; export renders at resolution 1).
  vGlobal = position + uGlobalFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

const FRAGMENT = `#version 300 es
in vec2 vTextureCoord;
in vec2 vGlobal;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform mat3 uWorldToLocal;
uniform vec4 uRectA;
uniform vec4 uRectB;
uniform vec2 uRadii;

// Signed distance to a rounded rectangle (x, y, w, h), negative inside.
float roundedRectDistance(vec2 p, vec4 rect, float radius) {
  vec2 half_ = rect.zw * 0.5;
  float r = min(radius, min(half_.x, half_.y));
  vec2 q = abs(p - (rect.xy + half_)) - half_ + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Coverage of the pixel: the edge fades over one screen pixel centred on it,
// whatever the scale between local units and pixels (fwidth measures it per
// pixel). Where the recording itself ends at the same edge, it is drawn
// without MSAA, so the outer half of that fade has less under it than MSAA
// gave; the edge sits within a pixel of where MSAA put it.
float coverage(vec2 p, vec4 rect, float radius) {
  float d = roundedRectDistance(p, rect, radius);
  float w = max(fwidth(d), 1e-4);
  return clamp(0.5 - d / w, 0.0, 1.0);
}

void main(void)
{
  vec2 local = (uWorldToLocal * vec3(vGlobal, 1.0)).xy;
  float c = coverage(local, uRectA, uRadii.x) * coverage(local, uRectB, uRadii.y);
  finalColor = texture(uTexture, vTextureCoord) * c;
}`;

interface RoundedClipUniforms {
  uWorldToLocal: Matrix;
  uRectA: Float32Array;
  uRectB: Float32Array;
  uRadii: Float32Array;
}

/**
 * Cuts the container it is set on to the intersection of two rounded
 * rectangles in that container's local coordinates, with a smooth edge.
 * The container's transform is read when the filter runs, during the render,
 * so zoom, pan and tilt set later in the frame are taken into account.
 */
export class RoundedClipFilter extends Filter {
  private readonly clipUniforms: UniformGroup;
  // The objects the uniform group holds: written in place, then update().
  private readonly u: RoundedClipUniforms;
  private readonly worldTransform = new Matrix();
  private target: Container | null = null;

  constructor() {
    const u: RoundedClipUniforms = {
      uWorldToLocal: new Matrix(),
      uRectA: new Float32Array(4),
      uRectB: new Float32Array(4),
      uRadii: new Float32Array(2),
    };
    const clipUniforms = new UniformGroup({
      uWorldToLocal: { value: u.uWorldToLocal, type: 'mat3x3<f32>' },
      uRectA: { value: u.uRectA, type: 'vec4<f32>' },
      uRectB: { value: u.uRectB, type: 'vec4<f32>' },
      uRadii: { value: u.uRadii, type: 'vec2<f32>' },
    });
    super({
      glProgram: GlProgram.from({
        vertex: VERTEX,
        fragment: FRAGMENT,
        name: 'rounded-clip',
        // Local coordinates run into the thousands; mediump would band the edge.
        preferredFragmentPrecision: 'highp',
      }),
      resources: { roundedClipUniforms: clipUniforms },
      // The shader draws its own smooth edge; MSAA here would only cost time.
      antialias: 'off',
    });
    this.clipUniforms = clipUniforms;
    this.u = u;
  }

  /** The rectangles, in `target`'s local coordinates; call when they change. */
  setClip(target: Container, a: RoundedRect, b: RoundedRect): void {
    this.target = target;
    const u = this.u;
    u.uRectA.set([a.x, a.y, a.width, a.height]);
    u.uRectB.set([b.x, b.y, b.width, b.height]);
    u.uRadii.set([a.radius, b.radius]);
    this.clipUniforms.update();
  }

  override apply(
    filterManager: Parameters<Filter['apply']>[0],
    input: Parameters<Filter['apply']>[1],
    output: Parameters<Filter['apply']>[2],
    clearMode: boolean,
  ): void {
    if (this.target) {
      // The transform of the pass being drawn, as Pixi's own filters take it
      // (FilterSystem.calculateSpriteMatrix): not the scene's global one, so
      // a render of part of the scene into a texture (the mask effect's
      // snapshot of compositeContainer) is cut in the right place too.
      const u = this.u;
      const world = this.worldTransform.copyFrom(this.target.worldTransform);
      const renderGroup = this.target.renderGroup ?? this.target.parentRenderGroup;
      if (renderGroup?.cacheToLocalTransform) {
        world.prepend(renderGroup.cacheToLocalTransform);
      }
      u.uWorldToLocal.copyFrom(world).invert();
      this.clipUniforms.update();
    }
    filterManager.applyFilter(this, input, output, clearMode);
  }
}

/**
 * A filter that changes nothing but renders what it wraps into an MSAA
 * texture of its bounds, so Graphics shapes and stencil masks *inside* that
 * subtree stay smooth on a canvas without MSAA. Only for small subtrees: the
 * cost grows with the area.
 *
 * Pixi draws a container's own `.mask` outside its filters, so a mask on the
 * same container is not smoothed; put this on a parent of the masked one.
 */
export function createLocalMsaaFilter(): AlphaFilter {
  return new AlphaFilter({ alpha: 1, antialias: 'on' });
}

/**
 * Wraps `child` in a new container holding a local-MSAA filter, at the same
 * place in its parent's child list. Returns the wrapper.
 */
export function wrapWithLocalMsaa(child: Container): Container {
  const wrapper = new Container();
  wrapper.label = `${child.label || 'node'}-msaa`;
  const parent = child.parent;
  const index = parent ? parent.getChildIndex(child) : -1;
  wrapper.addChild(child);
  if (parent) {
    parent.addChildAt(wrapper, index);
  }
  wrapper.filters = [createLocalMsaaFilter()];
  return wrapper;
}
