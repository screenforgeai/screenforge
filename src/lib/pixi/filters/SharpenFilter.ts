import { Filter, GlProgram, UniformGroup } from 'pixi.js';

// Standard PixiJS v8 filter vertex shader (PixiJS built-in template).
const VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * -(2.0 / uOutputTexture.y) + 1.0;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

// 8-tap Gaussian-weighted unsharp mask.
// Cardinals weight 2/12, diagonals 1/12 — matches a 3×3 Gaussian kernel.
// RGB-only: alpha is passed through unchanged to avoid compositing artefacts.
//
// IMPORTANT: the UBO block must be named "localUniforms" — this is the name
// PixiJS v8's UboSystem recognises and binds automatically. Any other name
// produces an "unbound uniform buffer" GL error and uStrength stays 0.
const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

layout(std140) uniform localUniforms {
    float uStrength;
};

void main(void) {
    vec2 px = uInputSize.zw;

    vec4 c  = texture(uTexture, vTextureCoord);
    vec3 n  = texture(uTexture, vTextureCoord + vec2( 0.0,  -px.y)).rgb;
    vec3 s  = texture(uTexture, vTextureCoord + vec2( 0.0,   px.y)).rgb;
    vec3 e  = texture(uTexture, vTextureCoord + vec2( px.x,  0.0 )).rgb;
    vec3 w  = texture(uTexture, vTextureCoord + vec2(-px.x,  0.0 )).rgb;
    vec3 ne = texture(uTexture, vTextureCoord + vec2( px.x, -px.y)).rgb;
    vec3 nw = texture(uTexture, vTextureCoord + vec2(-px.x, -px.y)).rgb;
    vec3 se = texture(uTexture, vTextureCoord + vec2( px.x,  px.y)).rgb;
    vec3 sw = texture(uTexture, vTextureCoord + vec2(-px.x,  px.y)).rgb;

    vec3 blur = (n + s + e + w) * (2.0/12.0) + (ne + nw + se + sw) * (1.0/12.0);
    finalColor = vec4(clamp(c.rgb + uStrength * (c.rgb - blur), 0.0, 1.0), c.a);
}
`;

/**
 * Unsharp-mask sharpening filter for zoom.
 *
 * Attach once to stage.filters at setup (enabled=false). Toggle enabled
 * during zoom — PixiJS skips the FBO entirely when disabled, zero overhead.
 * The FBO stays allocated after first use so enable/disable is a flag flip.
 */
export class SharpenFilter extends Filter {
  private _group: UniformGroup;

  constructor(strength = 0.0) {
    // ubo:true → PixiJS allocates a real WebGL2 UBO buffer.
    // Key must match the layout(std140) block name in the fragment shader.
    const group = new UniformGroup({ uStrength: { value: strength, type: 'f32' } }, { ubo: true });

    super({
      glProgram: GlProgram.from({
        vertex: VERTEX,
        fragment: FRAGMENT,
        name: 'sharpen-filter',
      }),
      resources: { localUniforms: group },
    });

    this._group = group;
    this.padding = 1;
  }

  get strength(): number {
    return (this._group.uniforms as { uStrength: number }).uStrength;
  }

  set strength(value: number) {
    (this._group.uniforms as { uStrength: number }).uStrength = value;
  }
}
