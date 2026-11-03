import { Filter, GlProgram, UniformGroup } from 'pixi.js';

const MAX_BLUR_SAMPLES = 14;

const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

layout(std140) uniform localUniforms {
    float uPerspectiveAmount;
    float uPerspectiveFocusX;
    float uPerspectiveFocusY;
    float uAspect;
    float uBlurCenterX;
    float uBlurCenterY;
    float uInnerRadius;
    float uBlurStrength;
    float uBlurSampleCount;
    float uSplitX;
    float uSplitY;
    float uContrast;
    float uSaturation;
    float uBrightness;
    float uFarBlurPixels;
    float uDepthAmount;
    float uFadeAmount;
    float uContentMinX;
    float uContentMinY;
    float uContentMaxX;
    float uContentMaxY;
};

vec2 toAspect(vec2 value) {
    return vec2(value.x * max(uAspect, 0.001), value.y);
}

vec2 fromAspect(vec2 value) {
    return vec2(value.x / max(uAspect, 0.001), value.y);
}

float resolvePlaneOverscan() {
    float amount = clamp(uPerspectiveAmount, 0.0, 0.5);
    if (amount <= 0.001) {
        return 0.0;
    }

    vec2 inputSize = max(uInputSize.xy, vec2(1.0));
    float blurOverscan = clamp(uFarBlurPixels / max(min(inputSize.x, inputSize.y), 1.0) * 2.4, 0.0, 0.06);
    return clamp(amount * 0.40 + blurOverscan, 0.0, 0.26);
}

vec2 resolvePlaneUv(vec2 position) {
    float overscan = resolvePlaneOverscan();
    return mix(vec2(-overscan), vec2(1.0 + overscan), position);
}

vec3 projectPlanePosition(vec2 uv) {
    float amount = clamp(uPerspectiveAmount, 0.0, 0.5);
    if (amount <= 0.001) {
        return vec3(uv, 1.0);
    }

    vec2 inputSize = max(uInputSize.xy, vec2(1.0));
    // Use the fixed clip-start tilt focus as the projection origin, not the live
    // cursor (uBlurCenterX/Y). This keeps the 3D warp stable when the cursor moves —
    // only the depth-of-field blur tracks the cursor, not the perspective geometry.
    vec2 focusOrigin = clamp(vec2(uPerspectiveFocusX, uPerspectiveFocusY), vec2(0.02), vec2(0.98));
    vec2 focusDirection = clamp(vec2(uPerspectiveFocusX, uPerspectiveFocusY), vec2(0.02), vec2(0.98));
    vec2 dirAspect = toAspect(focusDirection - vec2(0.5));
    float dirLength = length(dirAspect);
    if (dirLength <= 0.001) {
        return vec3(uv, 1.0);
    }

    vec2 dir = dirAspect / dirLength;
    float along = dot(toAspect(uv - focusOrigin), dir);

    // Compute the maximum safe z that guarantees the overscan quad fully covers
    // the canvas on all four edges, preventing perspective-induced gaps when the
    // focus origin is near a canvas edge (e.g. cursor far left → gap on right).
    float overscan = resolvePlaneOverscan();
    float safeMaxZ = min(
        min((1.0 + overscan - focusOrigin.x) / max(1.0 - focusOrigin.x, 0.001),
            (focusOrigin.x + overscan) / max(focusOrigin.x, 0.001)),
        min((1.0 + overscan - focusOrigin.y) / max(1.0 - focusOrigin.y, 0.001),
            (focusOrigin.y + overscan) / max(focusOrigin.y, 0.001))
    );

    float z = clamp(1.0 - along * amount * 0.80, 0.65, safeMaxZ);
    vec2 projectedUv = focusOrigin + (uv - focusOrigin) / z;

    return vec3(projectedUv, z);
}

vec4 filterVertexPosition(void) {
    vec3 projected = projectPlanePosition(resolvePlaneUv(aPosition));
    vec2 position = projected.xy * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position * projected.z, 0.0, projected.z);
}

vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

layout(std140) uniform localUniforms {
    float uPerspectiveAmount;
    float uPerspectiveFocusX;
    float uPerspectiveFocusY;
    float uAspect;
    float uBlurCenterX;
    float uBlurCenterY;
    float uInnerRadius;
    float uBlurStrength;
    float uBlurSampleCount;
    float uSplitX;
    float uSplitY;
    float uContrast;
    float uSaturation;
    float uBrightness;
    float uFarBlurPixels;
    float uDepthAmount;
    float uFadeAmount;
    float uContentMinX;
    float uContentMinY;
    float uContentMaxX;
    float uContentMaxY;
};

const int MAX_BLUR_SAMPLES = ${MAX_BLUR_SAMPLES};

vec2 toAspect(vec2 value) {
    return vec2(value.x * max(uAspect, 0.001), value.y);
}

vec2 fromAspect(vec2 value) {
    return vec2(value.x / max(uAspect, 0.001), value.y);
}

vec2 contentMinUv(vec2 inputSize) {
    return vec2(uContentMinX, uContentMinY) / inputSize;
}

vec2 contentMaxUv(vec2 inputSize) {
    return vec2(uContentMaxX, uContentMaxY) / inputSize;
}

vec2 sampleContentMinUv(vec2 inputSize) {
    return clamp(contentMinUv(inputSize), vec2(0.0), vec2(1.0));
}

vec2 sampleContentMaxUv(vec2 inputSize) {
    return clamp(contentMaxUv(inputSize), vec2(0.0), vec2(1.0));
}

float insideContentUv(vec2 uv, vec2 boundsMin, vec2 boundsMax) {
    return
        step(boundsMin.x, uv.x) *
        step(uv.x, boundsMax.x) *
        step(boundsMin.y, uv.y) *
        step(uv.y, boundsMax.y);
}

float insideExpandedContentUv(vec2 uv, vec2 boundsMin, vec2 boundsMax, vec2 inputSize) {
    float planeExpand = clamp(uPerspectiveAmount * 0.44 + uDepthAmount * 0.09, 0.0, 0.24);
    vec2 blurExpand = clamp(vec2(uFarBlurPixels + 8.0) / inputSize, vec2(0.0), vec2(0.08));
    vec2 expansion = max(vec2(planeExpand), blurExpand);
    vec2 expandedMin = boundsMin - expansion;
    vec2 expandedMax = boundsMax + expansion;

    return insideContentUv(uv, expandedMin, expandedMax);
}

float edgeDistanceAlong(vec2 origin, vec2 direction, vec2 boundsMin, vec2 boundsMax) {
    float distance = 100000.0;

    if (direction.x > 0.001) {
        distance = min(distance, (boundsMax.x - origin.x) / direction.x);
    } else if (direction.x < -0.001) {
        distance = min(distance, (boundsMin.x - origin.x) / direction.x);
    }

    if (direction.y > 0.001) {
        distance = min(distance, (boundsMax.y - origin.y) / direction.y);
    } else if (direction.y < -0.001) {
        distance = min(distance, (boundsMin.y - origin.y) / direction.y);
    }

    return max(distance, 0.001);
}

vec4 applyLook(vec4 color) {
    if (color.a <= 0.0) {
        return color;
    }

    color.rgb /= color.a;
    vec3 luminance = vec3(dot(vec3(0.2125, 0.7154, 0.0721), color.rgb));
    color.rgb = mix(vec3(0.5), mix(luminance, color.rgb, uSaturation), uContrast);
    color.rgb *= uBrightness;
    color.rgb *= color.a;
    return color;
}

vec4 readProjected(vec2 uv, bool applySplit) {
    vec2 source = uv;
    vec2 inputSize = max(uInputSize.xy, vec2(1.0));
    vec2 contentMin = contentMinUv(inputSize);
    vec2 contentMax = contentMaxUv(inputSize);
    float insideExpandedContent = insideExpandedContentUv(source, contentMin, contentMax, inputSize);

    if (insideExpandedContent > 0.5) {
        vec2 sampleMin = sampleContentMinUv(inputSize);
        vec2 sampleMax = sampleContentMaxUv(inputSize);
        if (sampleMax.x - sampleMin.x <= 0.0001 || sampleMax.y - sampleMin.y <= 0.0001) {
            return vec4(0.0);
        }
        vec2 contentSize = max(sampleMax - sampleMin, vec2(0.001));
        vec2 edgeInset = min(contentSize * 0.002, vec2(1.0) / inputSize);
        source = clamp(source, sampleMin + edgeInset, sampleMax - edgeInset);
    } else if (
        source.x < 0.0 ||
        source.x > 1.0 ||
        source.y < 0.0 ||
        source.y > 1.0
    ) {
        return vec4(0.0);
    }

    vec4 color = texture(uTexture, source);
    vec2 split = vec2(uSplitX, uSplitY) / max(uInputSize.xy, vec2(1.0));
    if (applySplit && dot(split, split) > 0.0000001) {
        vec2 redSource = clamp(source + split, vec2(0.0), vec2(1.0));
        vec2 blueSource = clamp(source - split, vec2(0.0), vec2(1.0));
        color.r = texture(uTexture, redSource).r;
        color.b = texture(uTexture, blueSource).b;
    }

    return color;
}

struct DirectionalDepthCue {
    float farMask;
    float nearMask;
    vec2 farDirUv;
};

DirectionalDepthCue resolveDirectionalDepthCue(vec2 uv) {
    DirectionalDepthCue cue;
    cue.farMask = 0.0;
    cue.nearMask = 0.0;
    cue.farDirUv = vec2(0.0);

    float depthAmount = clamp(uDepthAmount, 0.0, 1.0);
    if (depthAmount <= 0.001) {
        return cue;
    }

    vec2 inputSize = max(uInputSize.xy, vec2(1.0));
    vec2 contentMin = contentMinUv(inputSize);
    vec2 contentMax = contentMaxUv(inputSize);
    float insideContent = insideContentUv(uv, contentMin, contentMax);
    if (insideContent < 0.5) {
        return cue;
    }
    vec2 visibleMin = clamp(contentMin, vec2(0.0), vec2(1.0));
    vec2 visibleMax = clamp(contentMax, vec2(0.0), vec2(1.0));
    if (visibleMax.x - visibleMin.x <= 0.0001 || visibleMax.y - visibleMin.y <= 0.0001) {
        return cue;
    }

    vec2 focusOrigin = clamp(vec2(uBlurCenterX, uBlurCenterY) / inputSize, vec2(0.0), vec2(1.0));
    vec2 focusDirection = focusOrigin;
    vec2 directionAspect = toAspect(focusDirection - vec2(0.5));
    float directionLength = length(directionAspect);
    if (directionLength <= 0.001) {
        focusDirection = clamp(vec2(uPerspectiveFocusX, uPerspectiveFocusY), vec2(0.02), vec2(0.98));
        directionAspect = toAspect(focusDirection - vec2(0.5));
        directionLength = length(directionAspect);
        if (directionLength <= 0.001) {
            return cue;
        }
    }

    vec2 dir = directionAspect / directionLength;
    vec2 p = toAspect(uv - focusOrigin);
    float along = dot(p, dir);
    vec2 focusAspect = toAspect(focusOrigin);
    vec2 visibleMinAspect = toAspect(visibleMin);
    vec2 visibleMaxAspect = toAspect(visibleMax);
    float farLimit = edgeDistanceAlong(focusAspect, -dir, visibleMinAspect, visibleMaxAspect);
    float nearLimit = edgeDistanceAlong(focusAspect, dir, visibleMinAspect, visibleMaxAspect);
    float farProgress = clamp((-along) / farLimit, 0.0, 1.0);
    float nearProgress = clamp(along / nearLimit, 0.0, 1.0);
    cue.farMask = smoothstep(0.06, 0.62, farProgress);
    cue.nearMask = smoothstep(0.05, 0.72, nearProgress);
    cue.farDirUv = fromAspect(-dir);
    cue.farDirUv /= max(length(cue.farDirUv), 0.001);

    return cue;
}

vec4 readContentClamped(vec2 uv, vec2 contentMin, vec2 contentMax) {
    vec2 inputSize = max(uInputSize.xy, vec2(1.0));
    vec2 sampleMin = clamp(contentMin, vec2(0.0), vec2(1.0));
    vec2 sampleMax = clamp(contentMax, vec2(0.0), vec2(1.0));
    if (sampleMax.x - sampleMin.x <= 0.0001 || sampleMax.y - sampleMin.y <= 0.0001) {
        return vec4(0.0);
    }
    vec2 contentSize = max(sampleMax - sampleMin, vec2(0.001));
    vec2 edgeInset = min(contentSize * 0.002, vec2(1.0) / inputSize);
    vec2 source = clamp(uv, sampleMin + edgeInset, sampleMax - edgeInset);
    return readProjected(source, false);
}

vec4 applyDirectionalDepth(vec2 uv, vec4 baseColor, DirectionalDepthCue cue) {
    vec4 color = baseColor;
    float farMask = clamp(cue.farMask, 0.0, 1.0);
    float depthAmount = clamp(uDepthAmount, 0.0, 1.0);
    vec2 inputSize = max(uInputSize.xy, vec2(1.0));
    vec2 centerUv = clamp(vec2(uBlurCenterX, uBlurCenterY) / inputSize, vec2(0.0), vec2(1.0));
    float distPx = length((uv - centerUv) * inputSize);
    float clearRadius = max(uInnerRadius * 1.28, 1.0);
    float clearFeather = max(uInnerRadius * 1.55, 96.0);
    float focusFalloff = smoothstep(clearRadius, clearRadius + clearFeather, distPx);
    float focusEffect = depthAmount * focusFalloff;
    float farBlurPixels = clamp(uFarBlurPixels, 0.0, 72.0);

    if (focusEffect > 0.001 && farBlurPixels > 0.001) {
        vec2 contentMin = contentMinUv(inputSize);
        vec2 contentMax = contentMaxUv(inputSize);
        float motionBoost = clamp(uBlurStrength * 90.0, 0.0, 1.0);
        float blurPx = farBlurPixels * (0.72 + focusFalloff * (0.55 + farMask * 0.28) + motionBoost * 0.22);
        vec2 radius = vec2(blurPx) / inputSize;
        vec4 blurred =
            readContentClamped(uv, contentMin, contentMax) * 0.20 +
            readContentClamped(uv + vec2(radius.x, 0.0), contentMin, contentMax) * 0.09 +
            readContentClamped(uv - vec2(radius.x, 0.0), contentMin, contentMax) * 0.09 +
            readContentClamped(uv + vec2(0.0, radius.y), contentMin, contentMax) * 0.09 +
            readContentClamped(uv - vec2(0.0, radius.y), contentMin, contentMax) * 0.09 +
            readContentClamped(uv + radius * vec2(1.15, 1.15), contentMin, contentMax) * 0.06 +
            readContentClamped(uv + radius * vec2(-1.15, 1.15), contentMin, contentMax) * 0.06 +
            readContentClamped(uv + radius * vec2(1.15, -1.15), contentMin, contentMax) * 0.06 +
            readContentClamped(uv + radius * vec2(-1.15, -1.15), contentMin, contentMax) * 0.06 +
            readContentClamped(uv + vec2(radius.x * 2.1, 0.0), contentMin, contentMax) * 0.035 +
            readContentClamped(uv - vec2(radius.x * 2.1, 0.0), contentMin, contentMax) * 0.035 +
            readContentClamped(uv + vec2(0.0, radius.y * 2.1), contentMin, contentMax) * 0.035 +
            readContentClamped(uv - vec2(0.0, radius.y * 2.1), contentMin, contentMax) * 0.035 +
            readContentClamped(uv + radius * vec2(2.45, 2.45), contentMin, contentMax) * 0.015 +
            readContentClamped(uv + radius * vec2(-2.45, 2.45), contentMin, contentMax) * 0.015 +
            readContentClamped(uv + radius * vec2(2.45, -2.45), contentMin, contentMax) * 0.015 +
            readContentClamped(uv + radius * vec2(-2.45, -2.45), contentMin, contentMax) * 0.015;
        color = mix(color, blurred, clamp(focusEffect * (0.88 + farMask * 0.18 + motionBoost * 0.18), 0.0, 0.78));
    }

    float fadeAmount = clamp(uFadeAmount, 0.0, 2.0);
    float irisFade = focusFalloff * depthAmount * fadeAmount;
    float exposureRoll = irisFade * (0.34 + farMask * 0.08);
    float focusLift = (1.0 - focusFalloff) * depthAmount * 0.016;
    color.rgb *= clamp(1.0 - exposureRoll + focusLift, 0.58, 1.012);
    return color;
}

void main(void) {
    vec4 color = readProjected(vTextureCoord, true);
    DirectionalDepthCue cue = resolveDirectionalDepthCue(vTextureCoord);
    finalColor = applyLook(applyDirectionalDepth(vTextureCoord, color, cue));
}
`;

export class CinematicZoomFilter extends Filter {
  private _group: UniformGroup;

  constructor() {
    const group = new UniformGroup(
      {
        uPerspectiveAmount: { value: 0, type: 'f32' },
        uPerspectiveFocusX: { value: 0.5, type: 'f32' },
        uPerspectiveFocusY: { value: 0.5, type: 'f32' },
        uAspect: { value: 1, type: 'f32' },
        uBlurCenterX: { value: 0, type: 'f32' },
        uBlurCenterY: { value: 0, type: 'f32' },
        uInnerRadius: { value: 0, type: 'f32' },
        uBlurStrength: { value: 0, type: 'f32' },
        uBlurSampleCount: { value: 1, type: 'f32' },
        uSplitX: { value: 0, type: 'f32' },
        uSplitY: { value: 0, type: 'f32' },
        uContrast: { value: 1, type: 'f32' },
        uSaturation: { value: 1, type: 'f32' },
        uBrightness: { value: 1, type: 'f32' },
        uFarBlurPixels: { value: 0, type: 'f32' },
        uDepthAmount: { value: 0, type: 'f32' },
        uFadeAmount: { value: 0, type: 'f32' },
        uContentMinX: { value: 0, type: 'f32' },
        uContentMinY: { value: 0, type: 'f32' },
        uContentMaxX: { value: 1, type: 'f32' },
        uContentMaxY: { value: 1, type: 'f32' },
      },
      { ubo: true },
    );

    super({
      glProgram: GlProgram.from({
        vertex: VERTEX,
        fragment: FRAGMENT,
        name: 'cinematic-zoom-filter',
      }),
      resources: { localUniforms: group },
    });

    this._group = group;
    this.padding = 0;
  }

  set perspectiveAmount(value: number) {
    (this._group.uniforms as { uPerspectiveAmount: number }).uPerspectiveAmount = value;
  }

  set perspectiveFocusX(value: number) {
    (this._group.uniforms as { uPerspectiveFocusX: number }).uPerspectiveFocusX = value;
  }

  set perspectiveFocusY(value: number) {
    (this._group.uniforms as { uPerspectiveFocusY: number }).uPerspectiveFocusY = value;
  }

  set aspect(value: number) {
    (this._group.uniforms as { uAspect: number }).uAspect = value;
  }

  set blurCenterX(value: number) {
    (this._group.uniforms as { uBlurCenterX: number }).uBlurCenterX = value;
  }

  set blurCenterY(value: number) {
    (this._group.uniforms as { uBlurCenterY: number }).uBlurCenterY = value;
  }

  set innerRadius(value: number) {
    (this._group.uniforms as { uInnerRadius: number }).uInnerRadius = value;
  }

  set blurStrength(value: number) {
    (this._group.uniforms as { uBlurStrength: number }).uBlurStrength = value;
  }

  set blurSampleCount(value: number) {
    (this._group.uniforms as { uBlurSampleCount: number }).uBlurSampleCount = value;
  }

  set splitX(value: number) {
    (this._group.uniforms as { uSplitX: number }).uSplitX = value;
  }

  set splitY(value: number) {
    (this._group.uniforms as { uSplitY: number }).uSplitY = value;
  }

  set contrast(value: number) {
    (this._group.uniforms as { uContrast: number }).uContrast = value;
  }

  set saturation(value: number) {
    (this._group.uniforms as { uSaturation: number }).uSaturation = value;
  }

  set brightness(value: number) {
    (this._group.uniforms as { uBrightness: number }).uBrightness = value;
  }

  set farBlurPixels(value: number) {
    (this._group.uniforms as { uFarBlurPixels: number }).uFarBlurPixels = value;
  }

  set depthAmount(value: number) {
    (this._group.uniforms as { uDepthAmount: number }).uDepthAmount = value;
  }

  set fadeAmount(value: number) {
    (this._group.uniforms as { uFadeAmount: number }).uFadeAmount = value;
  }

  set contentMinX(value: number) {
    (this._group.uniforms as { uContentMinX: number }).uContentMinX = value;
  }

  set contentMinY(value: number) {
    (this._group.uniforms as { uContentMinY: number }).uContentMinY = value;
  }

  set contentMaxX(value: number) {
    (this._group.uniforms as { uContentMaxX: number }).uContentMaxX = value;
  }

  set contentMaxY(value: number) {
    (this._group.uniforms as { uContentMaxY: number }).uContentMaxY = value;
  }
}
