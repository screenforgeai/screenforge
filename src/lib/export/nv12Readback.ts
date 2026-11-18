/**
 * Reads the export canvas back as NV12 instead of RGBA.
 *
 * A shader pass converts the frame to full-range BT.709 YUV 4:2:0 on the GPU
 * and writes it upright, so the CPU receives 1.5 bytes per pixel instead of 4
 * and no longer flips rows. The encoder's output is full-range BT.709 either
 * way, so the picture matches the RGBA path.
 *
 * The NV12 picture is packed into an RGBA8 target that readPixels can read on
 * every WebGL2 implementation: each texel holds four luma bytes, or two U/V
 * pairs. Rows are padded to a multiple of 4 bytes when the width is not.
 */

/** BT.709 luma weights. */
const KR = 0.2126;
const KG = 0.7152;
const KB = 0.0722;

export interface Nv12Layout {
  width: number;
  height: number;
  /** Bytes per row, the same for both planes. */
  stride: number;
  /** Size of the RGBA8 target that holds the packed picture, in texels. */
  targetWidth: number;
  targetHeight: number;
  /** Byte offset of the interleaved U/V plane. */
  uvOffset: number;
  byteLength: number;
}

/** Null when NV12 cannot hold the size (both sides must be even). */
export function nv12Layout(width: number, height: number): Nv12Layout | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width % 2 !== 0 ||
    height % 2 !== 0
  ) {
    return null;
  }
  const targetWidth = Math.ceil(width / 4);
  const stride = targetWidth * 4;
  const targetHeight = height + height / 2;
  return {
    width,
    height,
    stride,
    targetWidth,
    targetHeight,
    uvOffset: stride * height,
    byteLength: stride * targetHeight,
  };
}

/** Full-range BT.709 Y, U, V (0–1) of an sRGB colour (0–1); what the shader computes. */
export function rgbToYuv709Full(r: number, g: number, b: number): [number, number, number] {
  const y = KR * r + KG * g + KB * b;
  const u = (b - y) / (2 * (1 - KB)) + 0.5;
  const v = (r - y) / (2 * (1 - KR)) + 0.5;
  return [y, u, v];
}

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Output row r of the target is memory row r of the readback (readPixels
// starts at the bottom row), so luma row r samples picture row r counted from
// the top, which is texture row height - 1 - r. Chroma averages each 2×2 block.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSource;
uniform ivec2 uSize;
out vec4 outColor;

const vec3 LUMA = vec3(${KR}, ${KG}, ${KB});

vec3 texel(int x, int y) {
  return texelFetch(uSource, ivec2(x, y), 0).rgb;
}

float luma(int x, int ty) {
  return x < uSize.x ? dot(texel(x, ty), LUMA) : 0.0;
}

vec2 chroma(int x, int ty) {
  if (x >= uSize.x) {
    return vec2(0.5);
  }
  vec3 c = (texel(x, ty) + texel(x + 1, ty) + texel(x, ty - 1) + texel(x + 1, ty - 1)) * 0.25;
  float y = dot(c, LUMA);
  return vec2((c.b - y) / ${(2 * (1 - KB)).toFixed(4)} + 0.5, (c.r - y) / ${(2 * (1 - KR)).toFixed(4)} + 0.5);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int x = p.x * 4;
  if (p.y < uSize.y) {
    int ty = uSize.y - 1 - p.y;
    outColor = vec4(luma(x, ty), luma(x + 1, ty), luma(x + 2, ty), luma(x + 3, ty));
  } else {
    int ty = uSize.y - 1 - 2 * (p.y - uSize.y);
    outColor = vec4(chroma(x, ty), chroma(x + 2, ty));
  }
}`;

export interface Nv12Readback {
  layout: Nv12Layout;
  /**
   * Converts what is on the canvas now and starts reading it into `pbo`
   * without waiting. Restores the framebuffer and viewport it found; other
   * state (program, blending, textures) is left changed, so the caller resets
   * its renderer's cached GL state afterwards.
   */
  readInto(pbo: WebGLBuffer): void;
  destroy(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('could not create shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader did not compile: ${info ?? 'no log'}`);
  }
  return shader;
}

interface CreatedObjects {
  textures: WebGLTexture[];
  framebuffers: WebGLFramebuffer[];
}

/** Registers what it creates in `created` first, so a failure can delete it. */
function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  created: CreatedObjects,
): { texture: WebGLTexture; framebuffer: WebGLFramebuffer } {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (texture) {
    created.textures.push(texture);
  }
  if (framebuffer) {
    created.framebuffers.push(framebuffer);
  }
  if (!texture || !framebuffer) {
    throw new Error('could not allocate a render target');
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`render target incomplete (0x${status.toString(16)})`);
  }
  return { texture, framebuffer };
}

/**
 * Sets up the conversion for a canvas of `width` × `height`. Throws when the
 * size or the context cannot take it; the caller then reads RGBA as before.
 */
export function createNv12Readback(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): Nv12Readback {
  const layout = nv12Layout(width, height);
  if (!layout) {
    throw new Error(`NV12 needs an even size, got ${width}×${height}`);
  }

  const savedFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const savedTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const created: CreatedObjects = { textures: [], framebuffers: [] };
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let vertexArray: WebGLVertexArrayObject | null = null;

  const destroy = (): void => {
    created.textures.forEach((t) => gl.deleteTexture(t));
    created.framebuffers.forEach((f) => gl.deleteFramebuffer(f));
    shaders.forEach((s) => gl.deleteShader(s));
    if (program) {
      gl.deleteProgram(program);
    }
    if (vertexArray) {
      gl.deleteVertexArray(vertexArray);
    }
  };

  try {
    // The canvas may be multisampled; a blit resolves it into a plain texture
    // the shader can read.
    const source = createTarget(gl, width, height, created);
    const packed = createTarget(gl, layout.targetWidth, layout.targetHeight, created);

    program = gl.createProgram();
    if (!program) {
      throw new Error('could not create program');
    }
    shaders.push(compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    shaders.push(compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    shaders.forEach((s) => gl.attachShader(program as WebGLProgram, s));
    gl.linkProgram(program);
    // Linked programs keep their code; the shader objects can go.
    shaders.splice(0).forEach((s) => gl.deleteShader(s));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program did not link: ${gl.getProgramInfoLog(program) ?? 'no log'}`);
    }
    const sourceLocation = gl.getUniformLocation(program, 'uSource');
    const sizeLocation = gl.getUniformLocation(program, 'uSize');
    vertexArray = gl.createVertexArray();
    const linkedProgram = program;
    const linkedVertexArray = vertexArray;

    const readback: Nv12Readback = {
      layout,
      readInto(pbo: WebGLBuffer): void {
        // Blink tracks the bound framebuffer itself, so this costs no round
        // trip to the GPU process (the viewport would).
        const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, source.framebuffer);
        gl.blitFramebuffer(
          0,
          0,
          width,
          height,
          0,
          0,
          width,
          height,
          gl.COLOR_BUFFER_BIT,
          gl.NEAREST,
        );

        gl.bindFramebuffer(gl.FRAMEBUFFER, packed.framebuffer);
        gl.viewport(0, 0, layout.targetWidth, layout.targetHeight);
        gl.disable(gl.BLEND);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.colorMask(true, true, true, true);
        gl.useProgram(linkedProgram);
        gl.bindVertexArray(linkedVertexArray);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, source.texture);
        gl.uniform1i(sourceLocation, 0);
        gl.uniform2i(sizeLocation, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        // Orphan: fresh storage, so the driver never waits on the last read.
        gl.bufferData(gl.PIXEL_PACK_BUFFER, layout.byteLength, gl.STREAM_READ);
        gl.readPixels(0, 0, layout.targetWidth, layout.targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        // The canvas's viewport, as Pixi leaves it after drawing a frame.
        gl.viewport(0, 0, width, height);
      },
      destroy,
    };

    // Run the whole conversion once now: a driver that rejects a step (the
    // multisample resolve, the packed target) fails here, while the caller
    // can still read RGBA, instead of giving black frames later. getError
    // waits for the GPU process, so it is checked only this once.
    // Clear errors left by earlier calls; they are not this setup's. Bounded:
    // a lost context reports an error on every call.
    for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++) {
      // keep reading
    }
    const probe = gl.createBuffer();
    if (!probe) {
      throw new Error('could not allocate a readback buffer');
    }
    try {
      readback.readInto(probe);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        throw new Error(`conversion failed (GL error 0x${error.toString(16)})`);
      }
    } finally {
      gl.deleteBuffer(probe);
    }
    return readback;
  } catch (error) {
    destroy();
    throw error;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, savedFramebuffer);
    gl.bindTexture(gl.TEXTURE_2D, savedTexture);
  }
}
