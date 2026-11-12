/**
 * Studio renderer: a screenshot on a thin glass-edged panel in a lit 3D
 * studio, rendered with three.js (WebGL 2).
 *
 * - Lighting comes from an environment of soft boxes (PMREM). The backdrop
 *   itself takes part in the reflections, faintly.
 * - The wall behind the panel shows the key light's shadow (the panel's
 *   silhouette projected from the light), a soft ambient shadow and the
 *   screen's own light, tinted by the wall.
 * - While the view is still, frames are re-rendered with sub-pixel jitter and a
 *   moving key light and averaged: crisp text and a true area-light shadow.
 *   After that the renderer idles until something changes.
 * - Post: lens blur with bokeh, glow, fish eye, colour fringe, tone curve,
 *   vignette and grain.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { TAARenderPass } from 'three/examples/jsm/postprocessing/TAARenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import { WALLPAPER_PRESETS } from 'src/lib/effects/frame';
import {
  defaultLightHandle,
  keyLightFromHandle,
  screenGainFor,
  type StudioCameraId,
  type StudioEdgeId,
  type StudioLightId,
  type StudioPoint,
  type StudioSettings,
  type StudioWallId,
} from './looks';
import {
  BACKDROP_FRAGMENT,
  BLOOM_HIGH_PASS_FRAGMENT,
  BOKEH_FRAGMENT,
  CATCHER_FRAGMENT,
  CATCHER_VERTEX,
  FADE_REFLECTOR_SHADER,
  FINISH_FRAGMENT,
  FULLSCREEN_VERTEX,
  SCREEN_EMISSIVE_GLSL,
  SCREEN_UNIFORMS_GLSL,
} from './shaders';

type Wall = { url: string } | { inner: string; outer: string } | { canvas: HTMLCanvasElement };

/** A backdrop chosen by the user, as the recorder's frame offers them. */
export type StudioBackdrop =
  | { kind: 'image'; url: string }
  | { kind: 'gradient'; angle: number; stops: { offset: number; color: string }[] }
  | { kind: 'solid'; color: string };

/** The frame settings the user sets on top of the look. Null keeps the look's own. */
export interface StudioFrame {
  /** Space around the screenshot, as a share of the output (0..0.4). */
  padding: number | null;
  /** Corner radius in px at 1080p. */
  radiusPx: number | null;
  /** Shadow strength 0..1. */
  shadowStr: number | null;
}

/** A CSS-style linear gradient (angle: 0 = to top, 90 = to right), painted into a canvas. */
const paintGradient = (angle: number, stops: { offset: number; color: string }[]) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 400 });
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const a = (angle * Math.PI) / 180;
    const half = (Math.abs(640 * Math.sin(a)) + Math.abs(400 * Math.cos(a))) / 2;
    const dx = Math.sin(a) * half;
    const dy = -Math.cos(a) * half;
    const g = ctx.createLinearGradient(320 - dx, 200 - dy, 320 + dx, 200 + dy);
    for (const stop of stops) {
      g.addColorStop(stop.offset, stop.color);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 400);
  }
  return canvas;
};
const STUDIO_WALLS: Record<
  Exclude<StudioWallId, 'night' | 'ventura' | 'sequoia' | 'shadeshifter'>,
  Wall
> = {
  graphite: { inner: '#3a3c42', outer: '#0b0c0e' },
  paper: { inner: '#f3f2ef', outer: '#b9b8b3' },
  black: { inner: '#141518', outer: '#030304' },
};
const wallFor = (id: StudioWallId): Wall => {
  if (id in STUDIO_WALLS) {
    return STUDIO_WALLS[id as keyof typeof STUDIO_WALLS];
  }
  const preset = WALLPAPER_PRESETS.find((item) => item.id === id) ?? WALLPAPER_PRESETS[0];
  return { url: preset.url };
};

// The glass edge refracts what is behind it and picks up the faint green of thick float glass.
const EDGES: Record<
  StudioEdgeId,
  {
    color: string;
    metalness: number;
    roughness: number;
    transmission: number;
    thickness: number;
    ior: number;
    attenuationColor: string;
    attenuationDistance: number;
    clearcoat: number;
  }
> = {
  glass: {
    color: '#ffffff',
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    thickness: 0.06,
    ior: 1.52,
    attenuationColor: '#a8dccd',
    attenuationDistance: 0.09,
    clearcoat: 1,
  },
  silver: {
    color: '#d4d6d9',
    metalness: 1,
    roughness: 0.2,
    transmission: 0,
    thickness: 0,
    ior: 1.5,
    attenuationColor: '#ffffff',
    attenuationDistance: Infinity,
    clearcoat: 0,
  },
  graphite: {
    color: '#2b2c2f',
    metalness: 0.95,
    roughness: 0.28,
    transmission: 0,
    thickness: 0,
    ior: 1.5,
    attenuationColor: '#ffffff',
    attenuationDistance: Infinity,
    clearcoat: 0,
  },
};

/** Soft-box layouts. Each box: [width, height, intensity, position, tint?]. `key` drives the cast shadow. */
type SoftBox = [number, number, number, [number, number, number], [number, number, number]?];
const LIGHTS: Record<StudioLightId, { room: number; key: number; boxes: SoftBox[] }> = {
  studio: {
    room: 0.06,
    key: 1.0,
    boxes: [
      [12, 6, 2.2, [0, 10, 1]],
      [2.6, 13, 3.2, [-8.5, 2, 3]],
      [2.4, 13, 1.8, [8.5, 1.5, 4.5]],
      [14, 1.4, 2.4, [0, 3.5, -9], [1, 0.97, 0.94]],
      [2.4, 10, 1.4, [-6, 1, -7]],
      [10, 4, 1.0, [0, 0.5, 10]],
      [24, 24, 0.15, [0, -6, 0]],
    ],
  },
  dramatic: {
    room: 0.012,
    key: 1.5,
    boxes: [
      [3, 14, 6, [-8, 2, 4]],
      [1.2, 10, 2.8, [7, 3, -6], [0.9, 0.95, 1]],
      [6, 2, 0.6, [0, 9, 4]],
      [24, 24, 0.04, [0, -6, 0]],
    ],
  },
  bright: {
    room: 0.42,
    key: 0.7,
    boxes: [
      [16, 8, 1.7, [0, 10, 2]],
      [12, 6, 1.1, [0, 1, 10]],
      [4, 12, 1.6, [-8, 2, 2]],
      [4, 12, 1.6, [8, 2, 2]],
      [24, 24, 0.5, [0, -6, 0]],
    ],
  },
  rim: {
    room: 0.015,
    key: 0.8,
    boxes: [
      [1.6, 14, 6, [-6, 2, -7]],
      [1.6, 14, 6, [6, 2, -7]],
      [8, 2, 0.9, [0, 8, 6]],
      [24, 24, 0.04, [0, -6, 0]],
    ],
  },
};

// A long lens, as in product photography; the macro camera is close and wide.
const CAMERAS: Record<StudioCameraId, { az: number; el: number; dist: number; fov: number }> = {
  hero: { az: 0.5, el: 0.12, dist: 1, fov: 20 },
  front: { az: 0, el: 0.02, dist: 0.95, fov: 20 },
  left: { az: -0.5, el: 0.12, dist: 1, fov: 20 },
  macro: { az: 0.16, el: 0.2, dist: 0.2, fov: 38 },
  // Straight-on, the screenshot filling about two thirds of the frame.
  straight: { az: 0, el: 0.02, dist: 0.52, fov: 26 },
};
const BASE_RADIUS = 13.6;
/** The framing was tuned at this width:height; narrower outputs pull the camera back. */
const REFERENCE_ASPECT = 1.45;

const PANEL_W = 3.4;
const LIFT = 0.42;
const PANEL_LAYER = 2;
const FACE_LAYER = 3;
const PROJ_RES = 512;
const PROJ_HALF = 3.6;
const TEXEL = (2 * PROJ_HALF) / PROJ_RES;
const LAYERED_FRAMES = 32;
const SHADOW_RES = 512;
const SHADOW_SIZE = 8;
const SHADOW_FAR = 1.4;
const SHADOW_CAM_DROP = 0.02;

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function rrShape(w: number, h: number, radius: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const r = Math.max(0.0005, Math.min(radius, w / 2, h / 2));
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Rounded slab with smooth (not faceted) bevels. */
function slab(w: number, h: number, depth: number, r: number, bevel: number): THREE.BufferGeometry {
  const core = Math.max(depth - 2 * bevel, 0.0001);
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(
    rrShape(w - 2 * bevel, h - 2 * bevel, Math.max(r - bevel, 0.0005)),
    {
      depth: core,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 10,
      curveSegments: 48,
      steps: 1,
    },
  );
  g.translate(0, 0, -core / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-6);
  g.computeVertexNormals();
  return g;
}

function rrPlane(w: number, h: number, r: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(rrShape(w, h, r), 48);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  }
  return g;
}

/** Mean linear brightness of a painted canvas, to keep a tinted room as bright as a plain one. */
function averageLinear(target: HTMLCanvasElement): number {
  const ctx = target.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return 0.1;
  }
  const px = ctx.getImageData(0, 0, target.width, target.height).data;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    sum += 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]);
  }
  return Math.max(sum / (px.length / 4), 0.01);
}

/** The fish-eye mapping the finish pass applies: output uv → source uv. */
function lensUv(uv: THREE.Vector2, aspect: number, fisheye: number): THREE.Vector2 {
  const ax = aspect;
  const dx = (uv.x - 0.5) * ax;
  const dy = uv.y - 0.5;
  const k = fisheye;
  const s = (1 + k * (dx * dx + dy * dy)) / (1 + k * (ax * ax * 0.25 + 0.25));
  return new THREE.Vector2((dx * s) / ax + 0.5, dy * s + 0.5);
}

export class StudioRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(20, 1, 0.1, 220);
  private readonly camTarget = new THREE.Vector3(0, 1.4, 0);
  private readonly panel = new THREE.Group();
  private panelParts: THREE.Mesh[] = [];
  private face: THREE.Mesh | null = null;
  private readonly panelBase = new THREE.Vector3(0, 1.4, 0);
  private readonly panelTarget = new THREE.Vector3(0, 1.4, 0);

  private s: StudioSettings;
  private media = { w: 1600, h: 1000 };
  private mediaLum = 0.5;
  private offset: StudioPoint = { x: 0, y: 0 };
  private depth = 0;
  /** The user's turn of the camera around the screenshot (radians) and its zoom (1 = the look's). */
  private orbit: StudioPoint = { x: 0, y: 0 };
  private zoom = 1;
  /** Focus point on the screen (screen-canvas pixels): chosen, else automatic, else the centre. */
  private focus: { x: number; y: number } | null = null;
  private autoFocus: { x: number; y: number } | null = null;
  private focusRange = 0;
  /** Light strength as a share of the look's own. */
  private lightPower = 1;
  /** The user's backdrop and frame, or null for the look's own. */
  private backdrop: Wall | null = null;
  private canvasWallTex: THREE.CanvasTexture | null = null;
  private frame: StudioFrame = { padding: null, radiusPx: null, shadowStr: null };
  /** The user's blur strength and light size (0..1), or null for the look's own. */
  private blurAmount: number | null = null;
  private lightSize: number | null = null;
  private handle: StudioPoint | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;

  private changeSeq = 0;
  private seenSeq = -1;
  private layerIndex = -1;
  private raf = 0;
  private disposed = false;
  private tween: {
    from: THREE.Spherical;
    to: THREE.Spherical;
    fromFov: number;
    toFov: number;
    t0: number;
    dur: number;
  } | null = null;

  // Environment
  private readonly pmrem: THREE.PMREMGenerator;
  private envTex: THREE.Texture | null = null;
  private readonly envMats = new Set<THREE.MeshPhysicalMaterial>();
  private readonly roomCanvas = Object.assign(document.createElement('canvas'), {
    width: 24,
    height: 12,
  });
  private readonly wallCanvas = Object.assign(document.createElement('canvas'), {
    width: 192,
    height: 120,
  });
  private readonly key = new THREE.DirectionalLight(0xffffff, 1);

  // Backdrop
  private readonly bgUniforms = {
    uMode: { value: 0 },
    tBg: { value: null as THREE.Texture | null },
    uBgAspect: { value: 1.6 },
    cInner: { value: new THREE.Color() },
    cOuter: { value: new THREE.Color() },
    uRes: { value: new THREE.Vector2(1, 1) },
  };
  private readonly bg: THREE.Mesh;
  private readonly wallTextures = new Map<string, THREE.Texture>();

  // Wall shadow and screen glow
  private readonly keyRT: THREE.WebGLRenderTarget;
  private readonly frontRT: THREE.WebGLRenderTarget;
  private readonly blurRT: THREE.WebGLRenderTarget;
  private readonly keyCam = new THREE.OrthographicCamera(
    -PROJ_HALF,
    PROJ_HALF,
    PROJ_HALF,
    -PROJ_HALF,
    0.1,
    40,
  );
  private readonly frontCam: THREE.OrthographicCamera;
  private readonly silhouetteMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide,
  });
  private readonly glowSourceMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  private readonly projQuad = new FullScreenQuad();
  private readonly projHBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  private readonly projVBlur = new THREE.ShaderMaterial(VerticalBlurShader);
  private readonly catcherUniforms: Record<string, THREE.IUniform>;
  private readonly catcher: THREE.Mesh;

  // Mirror floor and its contact shadow
  private readonly mirror: Reflector;
  private readonly shadowRT = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES);
  private readonly shadowRTBlur = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES);
  private readonly floorShadow: THREE.Mesh;
  private readonly blurPlane: THREE.Mesh;
  private readonly shadowCam: THREE.OrthographicCamera;
  private readonly depthMat = new THREE.MeshDepthMaterial();
  private readonly hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  private readonly vBlur = new THREE.ShaderMaterial(VerticalBlurShader);

  // Panel materials
  private readonly screenMat: THREE.MeshPhysicalMaterial;
  private readonly screenUniforms = {
    uGain: { value: 1 },
    uLcd: { value: 0 },
    uFade: { value: 0 },
    uFadeDir: { value: new THREE.Vector2(-0.7071, 0.7071) },
    uFadeSoft: { value: 0.5 },
  };
  private readonly edgeMat: THREE.MeshPhysicalMaterial;
  private readonly backMat: THREE.MeshPhysicalMaterial;
  private screenTex: THREE.Texture | null = null;

  // Post
  private readonly composer: EffectComposer;
  private readonly taa: TAARenderPass;
  private readonly bokeh: BokehPass;
  private readonly bloom: UnrealBloomPass;
  private readonly finish: ShaderPass;

  private readonly raycaster = new THREE.Raycaster();

  constructor(canvas: HTMLCanvasElement, settings: StudioSettings) {
    this.canvas = canvas;
    this.s = settings;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    if (!this.renderer.capabilities.isWebGL2) {
      this.renderer.dispose();
      throw new Error('Studio looks need WebGL 2');
    }
    // Tone mapping and sRGB encoding happen in the finish pass, so the scene stays linear HDR.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    const { scene } = this;
    scene.add(this.key, this.key.target);
    scene.add(this.panel);

    this.bg = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.bgUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader:
          'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: BACKDROP_FRAGMENT,
      }),
    );
    this.bg.renderOrder = -10;
    this.bg.frustumCulled = false;
    scene.add(this.bg);

    const makeProjRT = () => {
      const rt = new THREE.WebGLRenderTarget(PROJ_RES, PROJ_RES, { type: THREE.HalfFloatType });
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.keyRT = makeProjRT();
    this.frontRT = makeProjRT();
    this.blurRT = makeProjRT();
    this.keyCam.layers.set(PANEL_LAYER);
    this.frontCam = this.keyCam.clone();
    this.frontCam.layers.set(FACE_LAYER);
    this.catcherUniforms = {
      tKey: { value: this.keyRT.texture },
      uKeyProj: { value: new THREE.Matrix4() },
      uKeyOpacity: { value: 0.55 },
      tFront: { value: this.frontRT.texture },
      uFrontProj: { value: new THREE.Matrix4() },
      uAmbient: { value: 0.2 },
      uGlow: { value: 0.5 },
      ...this.bgUniforms,
    };
    this.catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 60),
      new THREE.ShaderMaterial({
        uniforms: this.catcherUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        vertexShader: CATCHER_VERTEX,
        fragmentShader: CATCHER_FRAGMENT,
      }),
    );
    this.catcher.renderOrder = -5;
    scene.add(this.catcher);

    this.mirror = new Reflector(new THREE.CircleGeometry(1, 96), {
      shader: FADE_REFLECTOR_SHADER,
      color: 0xffffff,
      textureWidth: 1024,
      textureHeight: 1024,
      clipBias: 0.003,
      multisample: 4,
    });
    const mirrorMat = this.mirror.material as THREE.ShaderMaterial;
    mirrorMat.transparent = true;
    mirrorMat.depthWrite = false;
    this.mirror.rotation.x = -Math.PI / 2;
    this.mirror.position.y = -0.0005;
    this.mirror.scale.setScalar(6.5);
    this.mirror.visible = false;
    scene.add(this.mirror);

    const shadowGroup = new THREE.Group();
    shadowGroup.position.y = 0.001;
    scene.add(shadowGroup);
    this.shadowRT.texture.generateMipmaps = false;
    this.shadowRTBlur.texture.generateMipmaps = false;
    const shadowPlaneGeo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
    this.floorShadow = new THREE.Mesh(
      shadowPlaneGeo,
      new THREE.MeshBasicMaterial({
        map: this.shadowRT.texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
      }),
    );
    this.floorShadow.renderOrder = 1;
    this.floorShadow.scale.set(SHADOW_SIZE, -1, SHADOW_SIZE);
    this.floorShadow.visible = false;
    shadowGroup.add(this.floorShadow);
    this.blurPlane = new THREE.Mesh(shadowPlaneGeo);
    this.blurPlane.visible = false;
    this.blurPlane.scale.set(SHADOW_SIZE, 1, SHADOW_SIZE);
    shadowGroup.add(this.blurPlane);
    this.shadowCam = new THREE.OrthographicCamera(
      -SHADOW_SIZE / 2,
      SHADOW_SIZE / 2,
      SHADOW_SIZE / 2,
      -SHADOW_SIZE / 2,
      0,
      SHADOW_FAR + SHADOW_CAM_DROP,
    );
    // Looking up from just below the floor, so the panel's underside is never clipped.
    this.shadowCam.rotation.x = Math.PI / 2;
    this.shadowCam.position.y = -SHADOW_CAM_DROP;
    shadowGroup.add(this.shadowCam);
    const darkness = { value: 1.3 };
    this.depthMat.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = darkness;
      shader.fragmentShader =
        'uniform float darkness;\n' +
        shader.fragmentShader.replace(
          'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
          'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );',
        );
    };
    this.depthMat.depthTest = false;
    this.depthMat.depthWrite = false;
    this.hBlur.depthTest = false;
    this.vBlur.depthTest = false;

    // The screenshot glows on its own (emissive) with no diffuse or base specular, so its pixels
    // come through unchanged; a clear glass layer on top (clearcoat) carries the reflections.
    this.screenMat = this.envMat(
      new THREE.MeshPhysicalMaterial({
        color: '#000000',
        emissive: '#ffffff',
        emissiveIntensity: 1,
        roughness: 0.6,
        metalness: 0,
        specularIntensity: 0,
        clearcoat: 0.5,
        clearcoatRoughness: 0.015,
      }),
      1,
    );
    this.screenMat.userData.isScreen = true;
    this.screenMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.screenUniforms);
      shader.fragmentShader =
        SCREEN_UNIFORMS_GLSL +
        shader.fragmentShader.replace('#include <emissivemap_fragment>', SCREEN_EMISSIVE_GLSL);
    };
    this.edgeMat = this.envMat(new THREE.MeshPhysicalMaterial(), 1);
    this.backMat = this.envMat(
      new THREE.MeshPhysicalMaterial({
        color: '#0c0d0f',
        roughness: 0.35,
        metalness: 0.6,
        clearcoat: 0.6,
      }),
      0.8,
    );

    // Post-processing. TAA does the anti-aliasing when still, so no MSAA on the composer targets.
    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }),
    );
    this.taa = new TAARenderPass(scene, this.camera, 0x000000, 1);
    this.taa.sampleLevel = 0;
    this.taa.unbiased = true;
    this.composer.addPass(this.taa);

    this.bokeh = new BokehPass(scene, this.camera, { focus: 13, aperture: 0.001, maxblur: 0.01 });
    this.bokeh.enabled = false;
    // Depth is packed into RGBA, which is exact only in 8-bit channels; the pass's own half-float
    // target loses enough precision a few metres out to blur pixels that are in focus.
    this.bokeh.renderTargetDepth.texture.type = THREE.UnsignedByteType;
    const bokehUniforms = this.bokeh.uniforms as Record<string, THREE.IUniform>;
    bokehUniforms.uFringe = { value: 0 };
    bokehUniforms.uRim = { value: 1.2 };
    bokehUniforms.uRange = { value: 0 };
    const bokehMaterial = new THREE.ShaderMaterial({
      defines: { DEPTH_PACKING: 1, PERSPECTIVE_CAMERA: 1 },
      uniforms: bokehUniforms,
      vertexShader: this.bokeh.materialBokeh.vertexShader,
      fragmentShader: BOKEH_FRAGMENT,
    });
    this.bokeh.materialBokeh = bokehMaterial;
    (this.bokeh as unknown as { fsQuad: FullScreenQuad }).fsQuad.material = bokehMaterial;
    // The wall must not count as near for depth of field, or the wallpaper would stay sharp.
    const bokehRender = this.bokeh.render.bind(this.bokeh);
    this.bokeh.render = (...args) => {
      const visible = this.catcher.visible;
      this.catcher.visible = false;
      bokehRender(...args);
      this.catcher.visible = visible;
    };
    this.composer.addPass(this.bokeh);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.5, 1.6);
    this.bloomHighPass().uMode = { value: 0 };
    this.bloom.materialHighPassFilter.fragmentShader = BLOOM_HIGH_PASS_FRAGMENT;
    this.bloom.materialHighPassFilter.needsUpdate = true;
    this.composer.addPass(this.bloom);

    this.finish = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uVignette: { value: 0.22 },
        uGrain: { value: 0.022 },
        uTime: { value: 0.37 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uFisheye: { value: 0 },
        uFringe: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: FINISH_FRAGMENT,
    });
    this.composer.addPass(this.finish);

    this.applySettings(false);
  }

  // ---------- public API ----------

  /** Start drawing; the renderer idles by itself once a still frame is complete. */
  start(): void {
    const loop = () => {
      if (this.disposed) {
        return;
      }
      this.raf = requestAnimationFrame(loop);
      this.step(performance.now(), false);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });
    for (const texture of this.wallTextures.values()) {
      texture.dispose();
    }
    this.screenTex?.dispose();
    this.envTex?.dispose();
    this.canvasWallTex?.dispose();
    this.pmrem.dispose();
    for (const rt of [this.keyRT, this.frontRT, this.blurRT, this.shadowRT, this.shadowRTBlur]) {
      rt.dispose();
    }
    this.mirror.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** Size in CSS pixels; `dpr` is the device pixel ratio to render at. */
  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.bgUniforms.uRes.value.copy(buffer);
    (this.finish.uniforms.uRes.value as THREE.Vector2).copy(buffer);
    (this.bokeh.uniforms as Record<string, THREE.IUniform>).aspect.value = this.width / this.height;
    // Camera distance depends on the output's shape.
    this.placeCamera(false);
    this.invalidate();
  }

  /** The screen content (screenshot with its annotations) and its mean brightness. */
  setScreen(source: HTMLCanvasElement, width: number, height: number, lum: number): void {
    const sameSize = this.media.w === width && this.media.h === height;
    if (this.screenTex && this.screenTex.image === source && sameSize) {
      this.screenTex.needsUpdate = true;
    } else {
      const old = this.screenTex;
      const texture = new THREE.CanvasTexture(source);
      texture.colorSpace = THREE.SRGBColorSpace;
      // No mipmaps: still frames average 32 jittered samples per pixel, which already
      // antialiases the screen, and mipmaps would only blur small text. It also skips
      // building a mip chain on every annotation edit.
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      this.screenTex = texture;
      this.screenMat.emissiveMap = texture;
      this.screenMat.needsUpdate = true;
      this.glowSourceMat.map = texture;
      this.glowSourceMat.needsUpdate = true;
      old?.dispose();
    }
    this.media = { w: width, h: height };
    if (lum !== this.mediaLum) {
      this.mediaLum = lum;
      this.screenUniforms.uGain.value = screenGainFor(this.s.screenGain, lum);
    }
    if (!sameSize || !this.face) {
      this.buildPanel();
      // A new panel size moves the camera's target; settings changes place the camera themselves.
      this.placeCamera(false);
    }
    this.invalidate();
  }

  setSettings(settings: StudioSettings, animate: boolean): void {
    this.s = settings;
    this.applySettings(animate);
  }

  /**
   * Where the screenshot sits: a shift of the output's width and height from
   * centre (measured at the screenshot's own depth), and a depth toward the
   * camera (a share of its distance; see `pose.ts`).
   */
  setOffset(offset: StudioPoint, depth = 0): void {
    this.offset = { ...offset };
    this.depth = depth;
    this.invalidate();
  }

  /**
   * Depth of field: what is sharp. `focus` is a point on the screen (screen-canvas pixels) the
   * user chose, `auto` the one picked from the screenshot's detail; `range` (0..1) widens the
   * area around it that stays completely sharp.
   */
  setFocus(
    focus: { x: number; y: number } | null,
    auto: { x: number; y: number } | null,
    range: number,
  ): void {
    this.focus = focus ? { ...focus } : null;
    this.autoFocus = auto ? { ...auto } : null;
    this.focusRange = range;
    this.invalidate();
  }

  /** Where depth of field is focused now (screen-canvas pixels), chosen or automatic. */
  getFocusPoint(): { x: number; y: number } {
    return this.focus ?? this.autoFocus ?? { x: this.media.w / 2, y: this.media.h / 2 };
  }

  /** Light strength as a share of the look's own (key light and reflections together). */
  setLightPower(power: number): void {
    if (power === this.lightPower) {
      return;
    }
    this.lightPower = power;
    this.applyEnv();
  }

  /** Blur strength 0..1 (depth of field), or null for the look's own. */
  setBlurAmount(amount: number | null): void {
    if (amount === this.blurAmount) {
      return;
    }
    this.blurAmount = amount;
    this.invalidate();
  }

  /** Size of the key light 0..1 (larger: softer shadows), or null for the look's own. */
  setLightSize(size: number | null): void {
    if (size === this.lightSize) {
      return;
    }
    this.lightSize = size;
    this.invalidate();
  }

  /** The wall behind the screenshot: a wallpaper, a gradient or a colour, or null for the look's. */
  setBackdrop(backdrop: StudioBackdrop | null): void {
    let wall: Wall | null = null;
    if (backdrop?.kind === 'image') {
      wall = { url: backdrop.url };
    } else if (backdrop?.kind === 'gradient') {
      wall = { canvas: paintGradient(backdrop.angle, backdrop.stops) };
    } else if (backdrop?.kind === 'solid') {
      // A colour wall still falls off a little toward the edges, as a lit studio wall does.
      const outer = new THREE.Color(backdrop.color).multiplyScalar(0.55);
      wall = { inner: backdrop.color, outer: `#${outer.getHexString()}` };
    }
    this.canvasWallTex?.dispose();
    this.canvasWallTex =
      wall && 'canvas' in wall
        ? Object.assign(new THREE.CanvasTexture(wall.canvas), { colorSpace: THREE.SRGBColorSpace })
        : null;
    this.backdrop = wall;
    this.applyBg();
    this.rebuildEnv();
  }

  /** Padding, corner radius and shadow on top of the look. */
  setFrame(frame: StudioFrame): void {
    const prev = this.frame;
    this.frame = { ...frame };
    if (frame.radiusPx !== prev.radiusPx) {
      this.buildPanel();
    }
    if (frame.padding !== prev.padding) {
      this.placeCamera(false);
    }
    this.invalidate();
  }

  private currentWall(): Wall {
    return this.backdrop ?? wallFor(this.s.wall);
  }

  private shadowStrength(): number {
    return this.frame.shadowStr ?? this.s.shadowStr;
  }

  /** A screen-canvas pixel as a point in the scene, on the screenshot's face. */
  private imagePointToWorld(x: number, y: number): THREE.Vector3 | null {
    const face = this.face;
    const texture = this.screenTex;
    if (!face || !texture) {
      return null;
    }
    this.updatePanelTransform();
    this.panel.updateMatrixWorld(true);
    const fu = (x / this.media.w - texture.offset.x) / texture.repeat.x;
    const fv = (1 - y / this.media.h - texture.offset.y) / texture.repeat.y;
    const { halfWidth = 1, halfHeight = 1 } = this.panel.userData as {
      halfWidth?: number;
      halfHeight?: number;
    };
    return face.localToWorld(
      new THREE.Vector3((fu - 0.5) * 2 * halfWidth, (fv - 0.5) * 2 * halfHeight, 0),
    );
  }

  /** The closest the screenshot may come for the current look without reaching the lens. */
  maxDepth(): number {
    return Math.max(0, 1 - this.panelReach() / this.sphericalFor(this.s.camera).radius);
  }

  /**
   * Turn the camera around the screenshot and zoom it, on top of the look's own
   * angle and distance. Takes effect at once (no animation): it follows a drag.
   */
  setView(orbit: StudioPoint, zoom: number): void {
    if (orbit.x === this.orbit.x && orbit.y === this.orbit.y && zoom === this.zoom) {
      return;
    }
    this.orbit = { ...orbit };
    this.zoom = zoom;
    this.placeCamera(false);
  }

  /** The closest zoom for the current look that keeps the camera clear of the screenshot. */
  minZoom(): number {
    const own = this.lookRadius();
    return own > 0 ? (this.panelReach() * 1.15) / own : 1;
  }

  /** Half the panel's diagonal, with a margin: how far the screenshot reaches from its centre. */
  private panelReach(): number {
    const { halfWidth = PANEL_W / 2, halfHeight = 1 } = this.panel.userData as {
      halfWidth?: number;
      halfHeight?: number;
    };
    return Math.hypot(halfWidth, halfHeight) * 1.2;
  }

  private lookRadius(): number {
    return this.ownRadius(this.s.camera);
  }

  /**
   * The camera's own distance for a look. Straight-on with a padding set, it is the distance
   * at which the screenshot fills the output less that padding on its tighter side.
   */
  private ownRadius(id: StudioCameraId): number {
    const c = CAMERAS[id];
    if (id === 'straight' && this.frame.padding !== null) {
      const { halfWidth = PANEL_W / 2, halfHeight = 1 } = this.panel.userData as {
        halfWidth?: number;
        halfHeight?: number;
      };
      const tan = Math.tan(THREE.MathUtils.degToRad(c.fov / 2));
      const fill = THREE.MathUtils.clamp(1 - 2 * this.frame.padding, 0.25, 1);
      return Math.max(
        halfHeight / (tan * fill),
        halfWidth / (tan * Math.max(this.camera.aspect, 0.1) * fill),
      );
    }
    const fit = Math.max(1, REFERENCE_ASPECT / Math.max(this.camera.aspect, 0.1));
    return BASE_RADIUS * c.dist * fit;
  }

  /** Light handle position (fractions of the output), or null for the look's own light. */
  setLightHandle(handle: StudioPoint | null): void {
    this.handle = handle ? { ...handle } : null;
    this.applyEnv();
  }

  getLightHandle(): StudioPoint {
    return this.handle ?? defaultLightHandle(this.s.envRot);
  }

  /**
   * The screenshot pixel under a point of the output (fractions, 0,0 = top
   * left), or null when the point is off the screenshot.
   */
  pickImagePoint(u: number, v: number): { x: number; y: number } | null {
    const face = this.face;
    const texture = this.screenTex;
    if (!face || !texture) {
      return null;
    }
    this.updatePanelTransform();
    this.panel.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    const src = lensUv(new THREE.Vector2(u, 1 - v), this.width / this.height, this.fisheyeAmount());
    this.raycaster.setFromCamera(new THREE.Vector2(src.x * 2 - 1, src.y * 2 - 1), this.camera);
    const hit = this.raycaster.intersectObject(face, false)[0];
    if (!hit?.uv) {
      return null;
    }
    const tu = hit.uv.x * texture.repeat.x + texture.offset.x;
    const tv = hit.uv.y * texture.repeat.y + texture.offset.y;
    return { x: tu * this.media.w, y: (1 - tv) * this.media.h };
  }

  /** Where a screenshot pixel lands on the output (fractions, 0,0 = top left). */
  projectImagePoint(x: number, y: number): StudioPoint | null {
    const world = this.imagePointToWorld(x, y);
    if (!world) {
      return null;
    }
    this.camera.updateMatrixWorld();
    const ndc = world.project(this.camera);
    const target = new THREE.Vector2(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    // Undo the fish eye: find the output uv the lens maps onto this point.
    const uv = target.clone();
    const aspect = this.width / this.height;
    const k = this.fisheyeAmount();
    for (let i = 0; i < 6; i++) {
      uv.sub(lensUv(uv, aspect, k).sub(target));
    }
    return { x: uv.x, y: 1 - uv.y };
  }

  /**
   * Render a finished still at `width`×`height` device pixels (all sharp frames
   * layered) and return it on a 2D canvas. The live view is restored afterwards.
   */
  renderStill(width: number, height: number): HTMLCanvasElement {
    const prev = { w: this.width, h: this.height, dpr: this.dpr };
    if (this.tween) {
      this.tween.t0 = -Infinity;
    }
    this.resize(width, height, 1);
    for (let i = 0; i < LAYERED_FRAMES + 3; i++) {
      this.step(performance.now(), i > 0);
    }
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    out.getContext('2d')?.drawImage(this.canvas, 0, 0, width, height);
    this.resize(prev.w, prev.h, prev.dpr);
    return out;
  }

  // ---------- internals ----------

  private bloomHighPass(): Record<string, THREE.IUniform> {
    return this.bloom.highPassUniforms as Record<string, THREE.IUniform>;
  }

  private invalidate(): void {
    this.changeSeq++;
  }

  private fisheyeAmount(): number {
    return this.s.fisheye * 0.6;
  }

  private envMat(m: THREE.MeshPhysicalMaterial, base: number): THREE.MeshPhysicalMaterial {
    m.envMap = this.envTex;
    m.userData.envBase = base;
    this.envMats.add(m);
    return m;
  }

  private applySettings(animate: boolean): void {
    const s = this.s;
    this.applyBg();
    this.applyEdge();
    this.rebuildEnv();
    this.applyEnv();
    this.buildPanel();

    this.mirror.visible = this.floorShadow.visible = s.floor;
    ((this.mirror.material as THREE.ShaderMaterial).uniforms.strength as THREE.IUniform).value =
      s.mirrorStr;
    (this.floorShadow.material as THREE.MeshBasicMaterial).opacity =
      0.4 + 0.5 * this.shadowStrength();

    this.bokeh.enabled = s.dof;
    this.bloom.enabled = s.glow;
    const colour = s.bloomMode === 'colour';
    const highPass = this.bloomHighPass();
    highPass.uMode.value = colour ? 1 : 0;
    this.bloom.threshold = colour ? 0.25 : 1.6;
    highPass.smoothWidth.value = colour ? 0.25 : 0.01;
    this.bloom.strength = colour ? 0.6 : 0.3;
    this.bloom.radius = colour ? 0.7 : 0.5;

    const fin = this.finish.uniforms;
    fin.uVignette.value = s.vignette;
    fin.uGrain.value = s.grain ? 0.022 : 0;
    fin.uFisheye.value = this.fisheyeAmount();
    fin.uFringe.value = s.fringe;

    const angle = THREE.MathUtils.degToRad(s.fadeAngle);
    this.screenUniforms.uFade.value = s.screenFade;
    this.screenUniforms.uFadeDir.value.set(Math.cos(angle), Math.sin(angle));
    this.screenUniforms.uFadeSoft.value = s.fadeSoft;
    this.screenUniforms.uLcd.value = s.lcd;
    this.screenUniforms.uGain.value = screenGainFor(s.screenGain, this.mediaLum);

    this.placeCamera(animate);
    this.invalidate();
  }

  // Backdrop

  private wallTexture(url: string): THREE.Texture {
    let texture = this.wallTextures.get(url);
    if (!texture) {
      texture = new THREE.TextureLoader().load(url, (loaded) => {
        const wall = this.currentWall();
        if (!this.disposed && 'url' in wall && wall.url === url) {
          const image = loaded.image as HTMLImageElement;
          this.bgUniforms.uBgAspect.value = image.width / image.height;
          this.rebuildEnv();
        }
        this.invalidate();
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      this.wallTextures.set(url, texture);
    }
    return texture;
  }

  private applyBg(): void {
    const wall = this.currentWall();
    if ('canvas' in wall && this.canvasWallTex) {
      this.bgUniforms.uMode.value = 1;
      this.bgUniforms.tBg.value = this.canvasWallTex;
      this.bgUniforms.uBgAspect.value = wall.canvas.width / wall.canvas.height;
    } else if ('url' in wall) {
      const texture = this.wallTexture(wall.url);
      this.bgUniforms.uMode.value = 1;
      this.bgUniforms.tBg.value = texture;
      const image = texture.image as HTMLImageElement | undefined;
      if (image?.width) {
        this.bgUniforms.uBgAspect.value = image.width / image.height;
      }
    } else if ('inner' in wall) {
      this.bgUniforms.uMode.value = 0;
      this.bgUniforms.cInner.value.set(wall.inner);
      this.bgUniforms.cOuter.value.set(wall.outer);
    }
    this.invalidate();
  }

  /** Paint the backdrop into a small canvas (drawn tiny, it comes out soft when stretched). */
  private paintBackdrop(target: HTMLCanvasElement): boolean {
    const ctx = target.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return false;
    }
    const wall = this.currentWall();
    if ('canvas' in wall) {
      ctx.drawImage(wall.canvas, 0, 0, target.width, target.height);
    } else if ('url' in wall) {
      const image = this.wallTexture(wall.url).image as HTMLImageElement | undefined;
      if (!image?.width) {
        return false;
      }
      ctx.drawImage(image, 0, 0, target.width, target.height);
    } else {
      const g = ctx.createRadialGradient(
        target.width / 2,
        target.height * 0.45,
        1,
        target.width / 2,
        target.height / 2,
        target.width * 0.6,
      );
      g.addColorStop(0, wall.inner);
      g.addColorStop(1, wall.outer);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, target.width, target.height);
    }
    return true;
  }

  private backdropTexture(target: HTMLCanvasElement): THREE.CanvasTexture | null {
    if (!this.paintBackdrop(target)) {
      return null;
    }
    const texture = new THREE.CanvasTexture(target);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /** The studio the reflections see: a dark room tinted by the backdrop, plus soft boxes. */
  private rebuildEnv(): void {
    const setup = LIGHTS[this.s.light];
    const env = new THREE.Scene();
    const amount = this.s.bgRefl;
    const roomTex = amount > 0 ? this.backdropTexture(this.roomCanvas) : null;
    const wallTex = amount > 0 ? this.backdropTexture(this.wallCanvas) : null;
    // Tinting the room must not lift it, or every reflection turns hazy.
    const roomScale = roomTex
      ? (setup.room / averageLinear(this.roomCanvas)) * (0.6 + 0.6 * amount)
      : setup.room;
    env.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(20, 48, 24),
        new THREE.MeshBasicMaterial({
          map: roomTex,
          color: new THREE.Color().setScalar(roomScale),
          side: THREE.BackSide,
        }),
      ),
    );
    if (wallTex) {
      const back = new THREE.Mesh(
        new THREE.PlaneGeometry(34, 21),
        new THREE.MeshBasicMaterial({
          map: wallTex,
          color: new THREE.Color().setScalar(1.2 * amount),
        }),
      );
      back.position.set(0, 1.5, -13);
      back.lookAt(0, 1.5, 0);
      env.add(back);
    }
    for (const [w, h, intensity, pos, tint = [1, 1, 1]] of setup.boxes) {
      const box = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(tint[0] * intensity, tint[1] * intensity, tint[2] * intensity),
          side: THREE.DoubleSide,
        }),
      );
      box.position.set(...pos);
      box.lookAt(0, 0, 0);
      env.add(box);
    }
    const old = this.envTex;
    this.envTex = this.pmrem.fromScene(env, 0.02).texture;
    env.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    roomTex?.dispose();
    wallTex?.dispose();
    for (const m of this.envMats) {
      m.envMap = this.envTex;
      if (!old) {
        m.needsUpdate = true;
      }
    }
    old?.dispose();
    this.invalidate();
  }

  private applyEnv(): void {
    const s = this.s;
    const key = this.handle ? keyLightFromHandle(this.handle) : null;
    const rot = THREE.MathUtils.degToRad(key ? key.envRot : s.envRot);
    for (const m of this.envMats) {
      m.envMapRotation.set(0, rot, 0);
      const boost = m.userData.isScreen ? 0.4 + 1.2 * s.reflect : 1;
      m.envMapIntensity = (m.userData.envBase as number) * s.envInt * this.lightPower * boost;
      if (m.userData.isScreen) {
        m.clearcoat = s.reflect;
      }
    }
    this.key.intensity = LIGHTS[s.light].key * s.envInt * this.lightPower;
    this.invalidate();
  }

  private placeKey(): void {
    const handle = this.getLightHandle();
    const { side, height } = keyLightFromHandle(handle);
    this.key.target.position.copy(this.panelTarget);
    this.key.position.set(
      this.panelTarget.x + side,
      this.panelTarget.y + height,
      this.panelTarget.z + 6.5,
    );
  }

  private applyEdge(): void {
    const e = EDGES[this.s.edge];
    const m = this.edgeMat;
    m.color.set(e.color);
    m.metalness = e.metalness;
    m.roughness = e.roughness;
    m.transmission = e.transmission;
    m.thickness = e.thickness;
    m.ior = e.ior;
    m.attenuationColor.set(e.attenuationColor);
    m.attenuationDistance = e.attenuationDistance;
    m.clearcoat = e.clearcoat;
    m.needsUpdate = true;
  }

  // Panel

  private buildPanel(): void {
    const s = this.s;
    // Wide screenshots take a fixed width; tall (mobile) ones a fixed height.
    const aspect = Math.min(3, Math.max(0.4, this.media.w / this.media.h));
    const h = aspect >= 1 ? PANEL_W / aspect : 2.6;
    const pw = aspect >= 1 ? PANEL_W : h * aspect;
    const r = ((this.frame.radiusPx ?? s.radiusPx) / 1080) * h * 1.25;
    const depth = 0.006 + s.thick * 0.08;
    const bevel = Math.min(depth / 2 - 0.0005, 0.014);
    for (const part of this.panelParts) {
      this.panel.remove(part);
      part.geometry.dispose();
    }
    const body = new THREE.Mesh(
      slab(pw, h, depth, Math.max(r, bevel + 0.001), Math.max(bevel, 0.0008)),
      this.edgeMat,
    );
    const face = new THREE.Mesh(
      rrPlane(pw - 0.0005, h - 0.0005, Math.max(r - 0.0003, 0.0005)),
      this.screenMat,
    );
    face.position.z = depth / 2 + 0.0004;
    const back = new THREE.Mesh(
      rrPlane(pw - 2 * bevel, h - 2 * bevel, Math.max(r - bevel, 0.0005)),
      this.backMat,
    );
    back.rotation.y = Math.PI;
    back.position.z = -depth / 2 - 0.0004;
    for (const part of [body, face, back]) {
      part.layers.enable(PANEL_LAYER);
    }
    face.layers.enable(FACE_LAYER);
    this.panelParts = [body, face, back];
    this.face = face;
    Object.assign(this.panel.userData, { halfWidth: pw / 2, halfHeight: h / 2, depth });
    this.panel.add(...this.panelParts);
    this.panelBase.set(0, LIFT + h / 2, 0);
    this.camTarget.copy(this.panelBase);
    if (this.screenTex) {
      this.fitTexture(this.screenTex, pw / h);
    }
    this.invalidate();
  }

  private fitTexture(texture: THREE.Texture, screenAspect: number): void {
    const a = this.media.w / this.media.h;
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    if (a > screenAspect) {
      texture.repeat.x = screenAspect / a;
      texture.offset.x = (1 - texture.repeat.x) / 2;
    } else {
      texture.repeat.y = a / screenAspect;
      texture.offset.y = (1 - texture.repeat.y) / 2;
    }
  }

  /** Tilt and lean, plus the 2D offset moved along the camera's own right and up. */
  private updatePanelTransform(): void {
    const s = this.s;
    this.panel.rotation.order = 'YXZ';
    this.panel.rotation.set(-THREE.MathUtils.degToRad(s.lean), THREE.MathUtils.degToRad(s.tilt), 0);
    this.camera.updateMatrixWorld();
    // Depth slides the screenshot along the line of sight; the 2D shift is measured at that
    // depth, so a drag follows the pointer 1:1 however near or far it is.
    const toTarget = this.camTarget.clone().sub(this.camera.position);
    const distance = toTarget.length();
    const along = distance * (1 - Math.min(this.depth, this.maxDepth()));
    const viewH = 2 * along * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const viewW = viewH * this.camera.aspect;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.panel.position
      .copy(this.camera.position)
      .addScaledVector(toTarget.normalize(), along)
      .addScaledVector(right, this.offset.x * viewW)
      .addScaledVector(up, -this.offset.y * viewH);
    this.panelTarget.copy(this.panel.position);

    // A tilted or leaned panel swings an edge back; keep the wall behind that edge.
    const {
      halfWidth = PANEL_W / 2,
      halfHeight = 1,
      depth = 0.03,
    } = this.panel.userData as {
      halfWidth?: number;
      halfHeight?: number;
      depth?: number;
    };
    const edgeBack =
      halfWidth * Math.abs(Math.sin(THREE.MathUtils.degToRad(s.tilt))) +
      halfHeight * Math.sin(THREE.MathUtils.degToRad(s.lean)) +
      depth +
      0.05;
    this.catcher.position.set(
      this.panelTarget.x,
      this.panelTarget.y,
      this.panelTarget.z - Math.max(0.14 + s.lift * 1.6, edgeBack),
    );
    const shadow = this.shadowStrength();
    this.catcherUniforms.uKeyOpacity.value = shadow * (1 - 0.3 * s.lift);
    this.catcherUniforms.uAmbient.value = shadow * 0.45;
    this.catcherUniforms.uGlow.value = s.screenGlow * 2.5;
    this.placeKey();
  }

  // Camera

  /** The look's camera, turned and zoomed by the user; never below the floor or inside the panel. */
  private sphericalFor(id: StudioCameraId): THREE.Spherical {
    const c = CAMERAS[id];
    const own = this.ownRadius(id);
    const radius = Math.max(own * this.zoom, Math.min(own, this.panelReach() * 1.15));
    const elevation = THREE.MathUtils.clamp(c.el + this.orbit.y, -0.02, 1.35);
    return new THREE.Spherical(radius, Math.PI / 2 - elevation, c.az + this.orbit.x);
  }

  private placeCamera(animate: boolean): void {
    const to = this.sphericalFor(this.s.camera);
    const toFov = CAMERAS[this.s.camera].fov;
    const reduceMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduceMotion) {
      this.tween = null;
      this.camera.position.setFromSpherical(to).add(this.camTarget);
      this.camera.fov = toFov;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.camTarget);
      this.invalidate();
      return;
    }
    const from = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.camTarget),
    );
    const dTheta = Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
    this.tween = {
      from,
      to: new THREE.Spherical(to.radius, to.phi, from.theta + dTheta),
      fromFov: this.camera.fov,
      toFov,
      t0: performance.now(),
      dur: 1100,
    };
  }

  private updateTween(now: number): void {
    const tween = this.tween;
    if (!tween) {
      return;
    }
    const k = Math.min(1, (now - tween.t0) / tween.dur);
    const e = easeInOut(k);
    const s = new THREE.Spherical(
      THREE.MathUtils.lerp(tween.from.radius, tween.to.radius, e),
      THREE.MathUtils.lerp(tween.from.phi, tween.to.phi, e),
      THREE.MathUtils.lerp(tween.from.theta, tween.to.theta, e),
    );
    this.camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.toFov, e);
    this.camera.updateProjectionMatrix();
    this.camera.position.setFromSpherical(s).add(this.camTarget);
    this.camera.lookAt(this.camTarget);
    if (k >= 1) {
      this.tween = null;
    }
  }

  // Wall shadow and glow

  private blurInto(rt: THREE.WebGLRenderTarget, texels: number): void {
    const r = this.renderer;
    this.projQuad.material = this.projHBlur;
    this.projHBlur.uniforms.tDiffuse.value = rt.texture;
    this.projHBlur.uniforms.h.value = texels / PROJ_RES;
    r.setRenderTarget(this.blurRT);
    this.projQuad.render(r);
    this.projQuad.material = this.projVBlur;
    this.projVBlur.uniforms.tDiffuse.value = this.blurRT.texture;
    this.projVBlur.uniforms.v.value = texels / PROJ_RES;
    r.setRenderTarget(rt);
    this.projQuad.render(r);
  }

  private renderInto(
    rt: THREE.WebGLRenderTarget,
    cam: THREE.Camera,
    material: THREE.Material,
  ): void {
    this.scene.overrideMaterial = material;
    this.renderer.setRenderTarget(rt);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.scene.overrideMaterial = null;
  }

  /** layerIndex: which layered frame this is (0..31), or -1 while things move. */
  private renderBackdropLight(layerIndex: number): void {
    const r = this.renderer;
    const oldClear = new THREE.Color();
    r.getClearColor(oldClear);
    const oldAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    const wallGap = this.panelTarget.z - this.catcher.position.z;
    const spread = 0.05 + (this.lightSize ?? this.s.lightSize) * 0.55; // the light's angular radius, radians
    const lightDir = this.key.position.clone().sub(this.panelTarget).normalize();
    if (layerIndex >= 0) {
      // A Vogel spiral spreads the layered light positions evenly over the light's disc.
      const radius = Math.sqrt((layerIndex + 0.5) / LAYERED_FRAMES) * spread;
      const a = layerIndex * 2.39996;
      const ju = new THREE.Vector3().crossVectors(lightDir, new THREE.Vector3(0, 1, 0)).normalize();
      const jv = new THREE.Vector3().crossVectors(ju, lightDir).normalize();
      lightDir
        .addScaledVector(ju, Math.cos(a) * radius)
        .addScaledVector(jv, Math.sin(a) * radius)
        .normalize();
    }
    this.keyCam.position.copy(this.panelTarget).addScaledVector(lightDir, 12);
    this.keyCam.lookAt(this.panelTarget);
    this.keyCam.updateMatrixWorld();
    this.renderInto(this.keyRT, this.keyCam, this.silhouetteMat);
    if (layerIndex >= 0) {
      this.blurInto(this.keyRT, 1.2);
    } else {
      // Stand-in while moving: a blur about as wide as the light's penumbra on the wall.
      const soft = Math.max(1.2, (wallGap * spread * 0.5) / (TEXEL * 2.7));
      this.blurInto(this.keyRT, soft);
      this.blurInto(this.keyRT, soft * 0.6);
      this.blurInto(this.keyRT, soft * 0.35);
    }
    this.frontCam.position.copy(this.panelTarget).add(new THREE.Vector3(0, 0, 12));
    this.frontCam.lookAt(this.panelTarget);
    this.frontCam.updateMatrixWorld();
    this.renderInto(this.frontRT, this.frontCam, this.glowSourceMat);
    const wide = 9 + this.s.lift * 8;
    this.blurInto(this.frontRT, wide);
    this.blurInto(this.frontRT, wide * 0.6);
    this.blurInto(this.frontRT, wide * 0.35);
    r.setRenderTarget(null);
    r.setClearColor(oldClear, oldAlpha);
    (this.catcherUniforms.uKeyProj.value as THREE.Matrix4).multiplyMatrices(
      this.keyCam.projectionMatrix,
      this.keyCam.matrixWorldInverse,
    );
    (this.catcherUniforms.uFrontProj.value as THREE.Matrix4).multiplyMatrices(
      this.frontCam.projectionMatrix,
      this.frontCam.matrixWorldInverse,
    );
  }

  private blurShadow(amount: number): void {
    const r = this.renderer;
    this.blurPlane.visible = true;
    this.blurPlane.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse.value = this.shadowRT.texture;
    this.hBlur.uniforms.h.value = amount / 256;
    r.setRenderTarget(this.shadowRTBlur);
    r.render(this.blurPlane, this.shadowCam);
    this.blurPlane.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse.value = this.shadowRTBlur.texture;
    this.vBlur.uniforms.v.value = amount / 256;
    r.setRenderTarget(this.shadowRT);
    r.render(this.blurPlane, this.shadowCam);
    this.blurPlane.visible = false;
  }

  private renderContactShadow(): void {
    const r = this.renderer;
    const hidden = [this.bg, this.mirror, this.floorShadow, this.catcher];
    const was = hidden.map((o) => o.visible);
    for (const o of hidden) {
      o.visible = false;
    }
    const clearAlpha = r.getClearAlpha();
    r.setClearAlpha(0);
    this.scene.overrideMaterial = this.depthMat;
    r.setRenderTarget(this.shadowRT);
    r.clear();
    r.render(this.scene, this.shadowCam);
    this.scene.overrideMaterial = null;
    this.blurShadow(3.2);
    this.blurShadow(1.2);
    r.setRenderTarget(null);
    r.setClearAlpha(clearAlpha);
    hidden.forEach((o, i) => {
      o.visible = was[i];
    });
  }

  // Frame

  private step(now: number, forceStill: boolean): void {
    const moving = !!this.tween;
    this.updateTween(now);
    const changed = this.seenSeq !== this.changeSeq;
    this.seenSeq = this.changeSeq;
    const still = forceStill || (!moving && !changed);
    if (!forceStill && still && this.layerIndex > LAYERED_FRAMES + 1) {
      return; // finished still frame on screen: idle
    }
    this.updatePanelTransform();
    this.layerIndex = still ? this.layerIndex + 1 : -1;
    this.taa.accumulate = still;
    this.bg.position.copy(this.camera.position);
    if (this.s.dof) {
      const u = this.bokeh.uniforms as Record<string, THREE.IUniform>;
      // Focus is the focus point's depth along the camera's view, as the lens blur measures it.
      const point = this.getFocusPoint();
      const world = this.imagePointToWorld(point.x, point.y) ?? this.panelTarget.clone();
      this.camera.updateMatrixWorld();
      u.focus.value = Math.max(-world.applyMatrix4(this.camera.matrixWorldInverse).z, 0.05);
      // Sharp area: up to 40% of the focus distance either side stays completely sharp.
      u.uRange.value = this.focusRange * (u.focus.value as number) * 0.4;
      const blur = this.blurAmount ?? this.s.dofAmt;
      u.aperture.value = blur * 0.12;
      u.maxblur.value = 0.003 + blur * 0.028;
      u.uFringe.value = this.s.fringe * 0.08;
    }
    if (this.layerIndex < LAYERED_FRAMES) {
      this.renderBackdropLight(this.layerIndex);
      if (this.s.floor) {
        this.renderContactShadow();
      }
    }
    this.composer.render();
  }
}
