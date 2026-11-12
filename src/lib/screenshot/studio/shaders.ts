/** GLSL for the studio renderer. Kept apart so the renderer reads as scene setup. */

/** Wallpaper (cover-fitted to the view) or a radial studio gradient. */
export const BACKDROP_COLOUR_GLSL = `
  uniform int uMode; uniform sampler2D tBg; uniform float uBgAspect;
  uniform vec3 cInner; uniform vec3 cOuter; uniform vec2 uRes;
  vec3 backdropColour() {
    vec2 uv = gl_FragCoord.xy / uRes;
    float viewAspect = uRes.x / uRes.y;
    if (uMode == 1) {
      vec2 t = uv - 0.5;
      if (viewAspect > uBgAspect) t.y *= uBgAspect / viewAspect; else t.x *= viewAspect / uBgAspect;
      return texture2D(tBg, t + 0.5).rgb;
    }
    vec2 d = uv - vec2(0.5, 0.56); d.x *= viewAspect;
    return mix(cInner, cOuter, smoothstep(0.0, 1.0, length(d) * 1.15));
  }`;

export const BACKDROP_FRAGMENT = `
  ${BACKDROP_COLOUR_GLSL}
  void main() { gl_FragColor = vec4(backdropColour(), 1.0); }`;

/**
 * The wall behind the panel: the key light's shadow (projected silhouette), a
 * faint ambient shadow, and the screen's own light tinted by the wall colour.
 * Premultiplied: the glow adds light, the shadows only darken.
 */
export const CATCHER_VERTEX = `
  uniform mat4 uKeyProj; uniform mat4 uFrontProj; varying vec4 vKey; varying vec4 vFront;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vKey = uKeyProj * wp; vFront = uFrontProj * wp;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

export const CATCHER_FRAGMENT = `
  uniform sampler2D tKey; uniform sampler2D tFront; uniform float uKeyOpacity; uniform float uAmbient; uniform float uGlow;
  ${BACKDROP_COLOUR_GLSL}
  varying vec4 vKey; varying vec4 vFront;
  vec4 sampleIn(sampler2D t, vec4 p) {
    vec2 uv = p.xy / p.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    return texture2D(t, uv);
  }
  void main() {
    float key = sampleIn(tKey, vKey).a * uKeyOpacity;
    vec4 front = sampleIn(tFront, vFront);
    float shade = 1.0 - (1.0 - key) * (1.0 - front.a * uAmbient);
    vec3 glow = front.rgb * backdropColour() * uGlow;
    gl_FragColor = vec4(glow, shade);
  }`;

/** Mirror floor that fades out toward its rim. */
export const FADE_REFLECTOR_SHADER = {
  name: 'FadeReflectorShader',
  uniforms: {
    color: { value: null as unknown },
    tDiffuse: { value: null as unknown },
    textureMatrix: { value: null as unknown },
    strength: { value: 0.3 },
  },
  vertexShader: `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vLocal;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0); vLocal = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float strength; varying vec4 vUv; varying vec2 vLocal;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 base = texture2DProj(tDiffuse, vUv);
      float fade = 1.0 - smoothstep(0.05, 0.85, length(vLocal));
      gl_FragColor = vec4(base.rgb * color, fade * fade * strength);
    }`,
};

/**
 * Injected into the screen material after its emissive map: the screen dims
 * toward one side (fade), dims when seen at a steep angle (viewing angle), and
 * is exposed by a gain.
 */
export const SCREEN_UNIFORMS_GLSL =
  'uniform float uGain; uniform float uLcd; uniform float uFade; uniform vec2 uFadeDir; uniform float uFadeSoft;\n';
export const SCREEN_EMISSIVE_GLSL = `#include <emissivemap_fragment>
  #ifdef USE_EMISSIVEMAP
    float fadeAt = dot(vEmissiveMapUv - 0.5, uFadeDir) / (0.5 * (abs(uFadeDir.x) + abs(uFadeDir.y))) * 0.5 + 0.5;
    totalEmissiveRadiance *= 1.0 - uFade * smoothstep(1.0 - uFadeSoft, 1.0, fadeAt);
  #endif
  float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance *= mix(1.0, smoothstep(0.15, 0.85, facing), uLcd) * uGain;`;

/**
 * Lens blur with real bokeh: a gather over a disc (Vogel spiral). Only true
 * highlights open into hard discs with a brighter rim; ordinary content gets a
 * soft-edged blur. Red and blue are sampled at slightly different radii.
 */
export const BOKEH_FRAGMENT = `
  #include <common>
  varying vec2 vUv;
  uniform sampler2D tColor; uniform sampler2D tDepth;
  uniform float maxblur; uniform float aperture; uniform float nearClip; uniform float farClip; uniform float focus; uniform float aspect;
  uniform float uFringe; uniform float uRim; uniform float uRange; uniform vec2 uTexel;
  uniform vec2 uFocusUv; uniform float uFallRadius;
  #include <packing>
  // Thin lens: blur grows with distance from the focus plane relative to distance from the camera.
  // A screenshot facing the camera lies in one plane, so on top of that the blur also grows with
  // distance across the frame from the focus point: straight-on, everything around the focus
  // ring stays sharp and the rest softens.
  float blurAt(vec2 p) {
    float viewZ = perspectiveDepthToViewZ(unpackRGBAToDepth(texture2D(tDepth, p)), nearClip, farClip);
    // uRange: depth either side of the focus that stays completely sharp (the sharp area).
    float lens = aperture * max(abs(focus + viewZ) - uRange, 0.0) / max(-viewZ, 1e-3);
    float away = length((p - uFocusUv) * vec2(aspect, 1.0)) - uFallRadius;
    float fall = maxblur * 0.6 * smoothstep(0.0, 0.5, away);
    return min(max(lens, fall), maxblur);
  }
  const int SAMPLES = 64;
  void main() {
    vec3 sharp = texture2D(tColor, vUv).rgb;
    // The depth map has one sample per pixel, so along a slanted edge the blur would switch from
    // sharp to soft in stair steps. Averaged with its diagonal neighbours, it changes smoothly.
    float c0 = 0.4 * blurAt(vUv) + 0.15 * (
      blurAt(vUv + uTexel * vec2(-1.0, -1.0)) + blurAt(vUv + uTexel * vec2(1.0, -1.0)) +
      blurAt(vUv + uTexel * vec2(-1.0, 1.0)) + blurAt(vUv + uTexel * vec2(1.0, 1.0)));
    if (c0 < 0.0004) { gl_FragColor = vec4(sharp, 1.0); return; }
    vec3 acc = vec3(0.0); float wsum = 0.0;
    // Each pixel turns the spiral by its own angle: a wide blur becomes fine grain, not stacked copies.
    float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    for (int i = 0; i < SAMPLES; i++) {
      float r = sqrt((float(i) + 0.5) / float(SAMPLES));
      float a = float(i) * 2.39996323 + spin;
      vec2 off = vec2(cos(a), sin(a)) * r * c0 * vec2(1.0, aspect);
      vec2 p = vUv + off;
      // A neighbour spreads onto this pixel only if it is itself that blurred.
      float cover = clamp((blurAt(p) - r * c0) / max(c0 * 0.15, 1e-4) + 1.0, 0.0, 1.0);
      vec3 col = vec3(
        texture2D(tColor, vUv + off * (1.0 + uFringe)).r,
        texture2D(tColor, p).g,
        texture2D(tColor, vUv + off * (1.0 - uFringe)).b);
      float hl = smoothstep(1.5, 2.5, dot(col, vec3(0.2126, 0.7152, 0.0722)));
      float w = cover * (1.0 + 3.0 * hl) * mix(1.0 - 0.6 * smoothstep(0.6, 1.0, r), 1.0 + uRim * r * r * r, hl);
      acc += col * w; wsum += w;
    }
    vec3 blurred = wsum > 0.0 ? acc / wsum : sharp;
    gl_FragColor = vec4(mix(sharp, blurred, smoothstep(0.0004, 0.0025, c0)), 1.0);
  }`;

/**
 * Bloom's bright-pass. Mode 0 picks light brighter than the screen's own white;
 * mode 1 picks vivid colour, so coloured UI glows while white text does not.
 */
export const BLOOM_HIGH_PASS_FRAGMENT = `
  uniform sampler2D tDiffuse; uniform vec3 defaultColor; uniform float defaultOpacity;
  uniform float luminosityThreshold; uniform float smoothWidth; uniform int uMode;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    float hi = max(texel.r, max(texel.g, texel.b)), lo = min(texel.r, min(texel.g, texel.b));
    float v = uMode == 1 ? (hi - lo) * hi * 2.0 : luminance(texel.rgb);
    float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
    gl_FragColor = mix(vec4(defaultColor.rgb, defaultOpacity), texel, alpha);
  }`;

/**
 * Final pass: fish eye and colour fringe, a tone curve that leaves everything
 * below 92% brightness as it was and only rolls off brighter highlights, sRGB,
 * vignette and grain.
 */
export const FINISH_FRAGMENT = `
  uniform sampler2D tDiffuse; uniform float uVignette; uniform float uGrain; uniform float uTime; uniform vec2 uRes;
  uniform float uFisheye; uniform float uFringe;
  varying vec2 vUv;
  vec2 lens(vec2 uv, float scale) {
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    vec2 d = (uv - 0.5) * asp;
    vec2 src = d * (1.0 + uFisheye * dot(d, d)) / (1.0 + uFisheye * dot(asp * 0.5, asp * 0.5)) * scale;
    return src / asp + 0.5;
  }
  vec3 tone(vec3 color) {
    float peak = max(color.r, max(color.g, color.b));
    const float knee = 0.92;
    if (peak <= knee) return color;
    float mapped = knee + (1.0 - knee) * (1.0 - exp(-(peak - knee) / (1.0 - knee)));
    vec3 c = color * (mapped / peak);
    float over = clamp((peak - 1.0) / 3.0, 0.0, 1.0);
    return mix(c, vec3(mapped), over * 0.6);
  }
  vec3 srgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    float ca = uFringe * 0.012;
    vec3 raw = vec3(
      texture2D(tDiffuse, lens(vUv, 1.0 + ca)).r,
      texture2D(tDiffuse, lens(vUv, 1.0)).g,
      texture2D(tDiffuse, lens(vUv, 1.0 - ca)).b);
    vec3 c = tone(raw);
    vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    c *= 1.0 - uVignette * smoothstep(0.45, 1.15, length(d));
    vec3 s = srgb(c);
    s += (hash(vUv * uRes + fract(uTime) * 517.0) - 0.5) * uGrain + (hash(vUv * uRes + 3.7) - 0.5) / 255.0;
    gl_FragColor = vec4(s, 1.0);
  }`;

export const FULLSCREEN_VERTEX =
  'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
