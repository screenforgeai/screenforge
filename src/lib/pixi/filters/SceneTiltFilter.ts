import { Filter, GlProgram, UniformGroup } from 'pixi.js';

/**
 * Rotates the filtered content in 3D around its centre and projects it with
 * perspective. The quad's vertices are moved in the vertex shader with a
 * homogeneous w, so the GPU interpolates texture coordinates
 * perspective-correctly — no per-pixel ray maths, one texture read per pixel.
 *
 * tiltX > 0 lays the top edge back; tiltY > 0 turns the right edge away.
 */
const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

layout(std140) uniform tiltUniforms {
    float uTiltX;
    float uTiltY;
    float uDistance;
};

void main(void) {
    vec2 size = uOutputFrame.zw;
    vec2 local = (aPosition - 0.5) * size;

    float cy = cos(uTiltY);
    float sy = sin(uTiltY);
    vec3 p = vec3(local.x * cy, local.y, local.x * sy);

    float cx = cos(uTiltX);
    float sx = sin(uTiltX);
    p = vec3(p.x, p.y * cx + p.z * sx, p.z * cx - p.y * sx);

    float distance = max(uDistance, 1.0);
    float w = max((distance + p.z) / distance, 0.05);
    vec2 position = p.xy / w + size * 0.5 + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    gl_Position = vec4(position * w, 0.0, w);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

void main(void) {
    finalColor = texture(uTexture, vTextureCoord);
}
`;

const DEG_TO_RAD = Math.PI / 180;

export class SceneTiltFilter extends Filter {
  private _group: UniformGroup;

  constructor() {
    const group = new UniformGroup(
      {
        uTiltX: { value: 0, type: 'f32' },
        uTiltY: { value: 0, type: 'f32' },
        uDistance: { value: 2000, type: 'f32' },
      },
      { ubo: true },
    );

    super({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'scene-tilt-filter' }),
      resources: { tiltUniforms: group },
    });

    this._group = group;
    this.padding = 0;
  }

  /**
   * @param tiltXDeg rotation around the horizontal axis, in degrees
   * @param tiltYDeg rotation around the vertical axis, in degrees
   * @param distance camera distance in pixels; smaller means stronger perspective
   */
  setTilt(tiltXDeg: number, tiltYDeg: number, distance: number) {
    const u = this._group.uniforms as { uTiltX: number; uTiltY: number; uDistance: number };
    u.uTiltX = tiltXDeg * DEG_TO_RAD;
    u.uTiltY = tiltYDeg * DEG_TO_RAD;
    u.uDistance = distance;
  }
}
