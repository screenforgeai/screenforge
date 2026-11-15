/**
 * Measures how much a background pre-render disturbs the editor: a window
 * animates like the preview (a fresh 1080p frame uploaded and drawn every
 * display frame) and records frame times, first alone, then alongside a
 * pre-render at each duty cycle. Test-only; run through the export harness
 * with SCREENFORGE_PRERENDER_PROBE=1.
 */
import fs from 'node:fs/promises';
import { BrowserWindow } from 'electron';
import type { CaptureWindowParams } from '../../src/types';
import { runExportPrerender, stopExportPrerender } from '../modules/export/service';

const PROBE_PAGE = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="1920" height="1080" style="width:100vw;height:100vh"></canvas>
<script>
const c = document.getElementById('c');
const gl = c.getContext('webgl2');
const src = document.createElement('canvas');
src.width = 1920; src.height = 1080;
const ctx = src.getContext('2d');
const vs = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vs, '#version 300 es\\nout vec2 uv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=vec2(p.x,1.0-p.y);gl_Position=vec4(p*2.0-1.0,0,1);}');
gl.compileShader(vs);
const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fs, '#version 300 es\\nprecision mediump float;in vec2 uv;uniform sampler2D t;out vec4 o;void main(){o=texture(t,uv);}');
gl.compileShader(fs);
const prog = gl.createProgram();
gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
gl.bindVertexArray(gl.createVertexArray());
const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
let intervals = []; let last = performance.now(); let n = 0;
function frame(now) {
  intervals.push(now - last); last = now; n++;
  ctx.fillStyle = '#123'; ctx.fillRect(0, 0, 1920, 1080);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'hsl(' + ((i * 37 + n) % 360) + ',70%,60%)';
    ctx.fillRect((i * 97 + n * 7) % 1920, (i * 53 + n * 3) % 1080, 180, 120);
  }
  ctx.fillStyle = '#fff'; ctx.font = '64px sans-serif'; ctx.fillText('frame ' + n, 80, 160);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__take = () => { const out = intervals; intervals = []; return out; };
</script></body></html>`;

export interface ProbePhase {
  label: string;
  frames: number;
  medianMs: number;
  p95Ms: number;
  /** Frames that took longer than 1.5 display intervals (visible stutter). */
  longFramePercent: number;
  /** Seconds of video the pre-render finished during the phase. */
  prerenderedSeconds?: number;
  /** Why the phase does not count: the pre-render was not running throughout. */
  skipped?: string;
}

function summarize(label: string, intervals: number[], refreshMs: number): ProbePhase {
  const sorted = [...intervals].sort((a, b) => a - b);
  const pick = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const long = intervals.filter((ms) => ms > refreshMs * 1.5).length;
  return {
    label,
    frames: intervals.length,
    medianMs: Math.round(pick(0.5) * 10) / 10,
    p95Ms: Math.round(pick(0.95) * 10) / 10,
    longFramePercent: Math.round((long / Math.max(1, intervals.length)) * 1000) / 10,
  };
}

async function countCachedChunks(cacheDir: string): Promise<number> {
  let count = 0;
  for (const ns of await fs.readdir(cacheDir).catch(() => [] as string[])) {
    const names = await fs.readdir(`${cacheDir}/${ns}`).catch(() => [] as string[]);
    count += names.filter((n) => n.endsWith('.json')).length;
  }
  return count;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPrerenderProbe(
  params: CaptureWindowParams,
  preloadPath: string,
  cacheDir: string,
  dutyCycles: number[],
  phaseMs: number,
): Promise<ProbePhase[]> {
  const probe = new BrowserWindow({
    width: 960,
    height: 540,
    show: true,
    focusable: false,
    webPreferences: { backgroundThrottling: false },
  });
  await probe.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PROBE_PAGE)}`);
  const take = () => probe.webContents.executeJavaScript('window.__take()') as Promise<number[]>;

  // Settle, then measure the display's frame interval on its own.
  await delay(1500);
  await take();
  await delay(phaseMs);
  const alone = await take();
  const refreshMs = summarize('', alone, 1000).medianMs || 16.7;
  const phases: ProbePhase[] = [summarize('editor alone', alone, refreshMs)];

  for (const dutyCycle of dutyCycles) {
    await fs.rm(cacheDir, { recursive: true, force: true });
    let settled = false;
    const running = runExportPrerender({ ...params, dutyCycle }, preloadPath).finally(() => {
      settled = true;
    });
    // Let the hidden window load and start rendering before measuring.
    await delay(3000);
    const endedBeforeMeasuring = settled;
    const chunksAtStart = await countCachedChunks(cacheDir);
    await take();
    await delay(phaseMs);
    const intervals = await take();
    const endedWhileMeasuring = settled;
    const chunks = (await countCachedChunks(cacheDir)) - chunksAtStart;
    stopExportPrerender();
    const ran = await running;
    // A refused or finished pre-render measured the editor alone, not alongside it.
    const skipped = !ran
      ? 'pre-render did not run'
      : endedBeforeMeasuring
        ? 'pre-render finished before measuring'
        : endedWhileMeasuring
          ? 'pre-render finished while measuring'
          : undefined;
    phases.push({
      ...summarize(`with pre-render at ${Math.round(dutyCycle * 100)}%`, intervals, refreshMs),
      prerenderedSeconds: chunks * 2,
      ...(skipped ? { skipped } : {}),
    });
  }

  probe.destroy();
  return phases;
}
