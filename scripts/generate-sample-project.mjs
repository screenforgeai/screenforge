#!/usr/bin/env node
/**
 * Generates the bundled sample project (src/assets/sample-project/):
 *   sample-project.mp4   a short screen recording of a made-up task board
 *   sample-project.json  the cursor, click and key events that go with it
 *
 * The page is rendered frame by frame from one scripted timeline, so the
 * video and the input events can never drift apart. The cursor is not drawn
 * into the video: like a real Screenforge recording, the editor draws it from
 * the events.
 *
 * Needs Playwright (with Chromium) and ffmpeg, neither of which is a project
 * dependency:
 *   NODE_PATH=$(npm root -g) node scripts/generate-sample-project.mjs
 *   FFMPEG=/path/to/ffmpeg node scripts/generate-sample-project.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src/assets/sample-project');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

// Logical (CSS) size of the recorded area. The video is rendered at 1.5x,
// like a Retina capture, so zooming in stays sharp.
const WIDTH = 1280;
const HEIGHT = 800;
const SCALE = 1.5;
const FPS = 30;
const DURATION = 12;
const MOVE_HZ = 60;

const TYPED_TEXT = 'Record the onboarding demo';

// ── Layout (logical px) ──────────────────────────────────────────────────────
const SHARE_BUTTON = { x: 1036, y: 16, w: 96, h: 34 };
const NEW_TASK_BUTTON = { x: 1144, y: 16, w: 112, h: 34 };
const COLUMN_X = [252, 596, 940];
const COLUMN_W = 320;
const CARD_TOP = 132;
const CARD_H = 84;
const CARD_GAP = 12;
const center = (r) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });
const NEW_CARD_INPUT = { x: COLUMN_X[0] + 16, y: CARD_TOP + 14, w: COLUMN_W - 32, h: 34 };

// ── Timeline (seconds) ───────────────────────────────────────────────────────
const T = {
  newTaskDown: 2.2,
  newTaskUp: 2.3,
  inputDown: 3.4,
  inputUp: 3.48,
  typeStart: 3.75,
  typeStep: 0.068,
  enter: 5.75,
  grabDown: 7.1,
  dragEnd: 8.6,
  dropUp: 8.7,
  shareDown: 10.2,
  shareUp: 10.3,
};

// Cursor keyframes: hold at `at` until `t`, or move there during [from, t].
const newTaskCenter = center(NEW_TASK_BUTTON);
const shareCenter = center(SHARE_BUTTON);
const inputPoint = { x: NEW_CARD_INPUT.x + 120, y: NEW_CARD_INPUT.y + 17 };
const grabPoint = { x: COLUMN_X[0] + 150, y: CARD_TOP + 40 };
const dropPoint = { x: COLUMN_X[1] + 150, y: CARD_TOP + 40 };
const PATH = [
  { t: 0, at: { x: 610, y: 520 } },
  { from: 0.8, t: 2.0, at: newTaskCenter },
  { from: 2.55, t: 3.25, at: inputPoint },
  { from: 5.95, t: 6.9, at: grabPoint },
  { from: 7.2, t: T.dragEnd, at: dropPoint },
  { from: 9.0, t: 10.0, at: shareCenter },
  { from: 10.6, t: 11.6, at: { x: 990, y: 210 } },
];

const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

function cursorAt(t) {
  let pos = PATH[0].at;
  for (let i = 1; i < PATH.length; i += 1) {
    const step = PATH[i];
    if (t >= step.t) {
      pos = step.at;
      continue;
    }
    if (t > step.from) {
      const u = ease((t - step.from) / (step.t - step.from));
      // A slight arc reads as a hand-moved mouse rather than a straight line.
      const arc = Math.sin(u * Math.PI) * Math.min(40, Math.abs(step.at.x - pos.x) * 0.06);
      return {
        x: pos.x + (step.at.x - pos.x) * u,
        y: pos.y + (step.at.y - pos.y) * u - arc,
      };
    }
    break;
  }
  return pos;
}

const isMoving = (t) =>
  PATH.some((step) => step.from !== undefined && t > step.from && t <= step.t);

function inside(rect, p) {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

function cursorTypeAt(t, p) {
  if (t >= T.grabDown && t < T.dropUp) {
    return 'grab';
  }
  if (inside(SHARE_BUTTON, p) || inside(NEW_TASK_BUTTON, p)) {
    return 'pointer';
  }
  if (t >= T.newTaskUp && t < T.enter && inside(NEW_CARD_INPUT, p)) {
    return 'text';
  }
  return 'default';
}

// ── Input events ─────────────────────────────────────────────────────────────
const NO_MODIFIERS = { meta: false, ctrl: false, alt: false, shift: false };

function buildEvents() {
  const events = [];
  const ms = (t) => Math.round(t * 1000);
  const point = (t) => {
    const p = cursorAt(t);
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  };

  events.push({ type: 'move', ...point(0), timestamp: 0, cursorType: 'default' });
  for (let i = 1; i <= DURATION * MOVE_HZ; i += 1) {
    const t = i / MOVE_HZ;
    if (!isMoving(t)) {
      continue;
    }
    const p = point(t);
    events.push({ type: 'move', ...p, timestamp: ms(t), cursorType: cursorTypeAt(t, p) });
  }

  const press = (down, up) => {
    events.push({ type: 'mousedown', ...point(down), button: 1, timestamp: ms(down) });
    events.push({ type: 'mouseup', ...point(up), button: 1, timestamp: ms(up) });
  };
  press(T.newTaskDown, T.newTaskUp);
  press(T.inputDown, T.inputUp);
  press(T.grabDown, T.dropUp);
  press(T.shareDown, T.shareUp);

  const key = (t, keyCategory) => {
    events.push({ type: 'keydown', keyCategory, modifiers: NO_MODIFIERS, timestamp: ms(t) });
    events.push({ type: 'keyup', keyCategory, modifiers: NO_MODIFIERS, timestamp: ms(t + 0.04) });
  };
  [...TYPED_TEXT].forEach((char, index) => {
    key(T.typeStart + index * T.typeStep, char === ' ' ? 'whitespace' : 'character');
  });
  key(T.enter, 'enter');

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Page ─────────────────────────────────────────────────────────────────────
const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #f6f7f9;
    font-family: Inter, system-ui, sans-serif; color: #1c2230; position: relative; }
  .abs { position: absolute; }
  .top { left: 0; top: 0; width: ${WIDTH}px; height: 66px; background: #fff; border-bottom: 1px solid #e6e8ee; }
  .logo { left: 28px; top: 20px; font-weight: 700; font-size: 19px; letter-spacing: -0.02em; display: flex; gap: 10px; align-items: center; }
  .logo i { width: 24px; height: 24px; border-radius: 7px; background: linear-gradient(135deg,#6d5efc,#35b8f5); display: inline-block; }
  .crumbs { left: 252px; top: 24px; font-size: 14px; color: #6b7385; }
  .crumbs b { color: #1c2230; font-weight: 600; }
  .btn { height: 34px; border-radius: 9px; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; transition: none; }
  .ghost { background: #fff; border: 1px solid #dfe2ea; color: #2a3142; }
  .ghost.hover { background: #f1f3f7; }
  .primary { background: #5b4ff5; color: #fff; }
  .primary.hover { background: #4b3fe6; }
  .pressed { transform: scale(0.96); }
  .side { left: 0; top: 66px; width: 220px; height: ${HEIGHT - 66}px; background: #fbfbfd; border-right: 1px solid #e6e8ee; padding: 20px 14px; }
  .nav { height: 34px; border-radius: 8px; padding: 0 12px; display: flex; align-items: center; gap: 10px; font-size: 14px; color: #4b5366; margin-bottom: 4px; }
  .nav.on { background: #eceafe; color: #3a2fd6; font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 3px; background: currentColor; opacity: .55; }
  .colhead { top: 92px; width: ${COLUMN_W}px; font-size: 13px; font-weight: 600; color: #4b5366; display: flex; gap: 8px; align-items: center; text-transform: uppercase; letter-spacing: .04em; }
  .count { background: #e8eaf0; border-radius: 10px; padding: 1px 8px; font-size: 12px; color: #5d6578; }
  .lane { top: 122px; width: ${COLUMN_W}px; height: ${HEIGHT - 146}px; border-radius: 14px; background: #eef0f4; }
  .card { width: ${COLUMN_W - 20}px; height: ${CARD_H}px; background: #fff; border-radius: 11px; border: 1px solid #e3e6ed; padding: 14px 16px; box-shadow: 0 1px 2px rgba(20,24,40,.05); }
  .card .title { font-size: 14.5px; font-weight: 600; margin-bottom: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card .meta { display: flex; gap: 8px; align-items: center; font-size: 12px; color: #7a8295; }
  .tag { border-radius: 6px; padding: 2px 8px; font-weight: 600; font-size: 11.5px; }
  .avatar { margin-left: auto; width: 22px; height: 22px; border-radius: 50%; }
  .lifted { box-shadow: 0 18px 40px rgba(20,24,40,.18), 0 2px 6px rgba(20,24,40,.08); transform: rotate(-1.5deg); }
  .input { height: 34px; border: 2px solid #5b4ff5; border-radius: 8px; padding: 0 10px; font-size: 14.5px; display: flex; align-items: center; background: #fff; }
  .placeholder { color: #a2a9b8; }
  .caret { width: 1.5px; height: 18px; background: #1c2230; margin-left: 1px; }
  .toast { left: 948px; top: 60px; width: 280px; background: #1c2230; color: #fff; border-radius: 10px; padding: 12px 14px; font-size: 13.5px; box-shadow: 0 12px 30px rgba(20,24,40,.25); }
  .toast small { display: block; color: #aab1c2; margin-top: 3px; font-size: 12px; }
</style></head><body><div id="root"></div></body></html>`;

// Runs inside the page: draws the whole UI for time t with the cursor at p.
function renderAt(state) {
  const { t, p, layout, T, typed } = state;
  const { COLUMN_X, COLUMN_W, CARD_TOP, CARD_H, CARD_GAP, SHARE_BUTTON, NEW_TASK_BUTTON } = layout;
  const inside = (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const pressed = (down, up) => t >= down && t < up + 0.06;
  const tags = {
    design: ['Design', '#fdeaf3', '#c02672'],
    eng: ['Engineering', '#e6f0ff', '#2457c5'],
    docs: ['Docs', '#e8f7ee', '#1d7a46'],
    launch: ['Launch', '#fff3e0', '#b45309'],
  };
  const avatars = ['#f59e0b', '#10b981', '#6366f1', '#ef4444', '#0ea5e9'];
  const card = (title, tag, avatar, extraClass = '', style = '') => {
    const [label, bg, fg] = tags[tag];
    return `<div class="card abs ${extraClass}" style="${style}"><div class="title">${title}</div>
      <div class="meta"><span class="tag" style="background:${bg};color:${fg}">${label}</span>
      <span>Due Fri</span><span class="avatar" style="background:${avatars[avatar]}"></span></div></div>`;
  };

  const columns = [
    [
      ['Write release notes', 'docs', 0],
      ['Polish the pricing page', 'design', 1],
      ['Fix export progress bar', 'eng', 2],
    ],
    [
      ['Onboarding checklist', 'design', 3],
      ['Update API docs', 'docs', 4],
    ],
    [
      ['Ship dark mode', 'eng', 0],
      ['Plan launch week', 'launch', 2],
    ],
  ];

  const typedCount =
    t < T.typeStart ? 0 : Math.min(typed.length, Math.floor((t - T.typeStart) / T.typeStep) + 1);
  const draftVisible = t >= T.newTaskUp;
  const committed = t >= T.enter;
  const dragging = t >= T.grabDown && t < T.dropUp;
  const dropped = t >= T.dropUp;
  const slot = CARD_H + CARD_GAP;
  const x0 = (col) => COLUMN_X[col] + 10;

  let html = `<div class="abs top"></div>
    <div class="abs logo"><i></i>Acme Tasks</div>
    <div class="abs crumbs">Projects / <b>Website relaunch</b></div>
    <div class="abs btn ghost ${inside(SHARE_BUTTON) ? 'hover' : ''} ${pressed(T.shareDown, T.shareUp) ? 'pressed' : ''}"
      style="left:${SHARE_BUTTON.x}px;top:${SHARE_BUTTON.y}px;width:${SHARE_BUTTON.w}px">Share</div>
    <div class="abs btn primary ${inside(NEW_TASK_BUTTON) ? 'hover' : ''} ${pressed(T.newTaskDown, T.newTaskUp) ? 'pressed' : ''}"
      style="left:${NEW_TASK_BUTTON.x}px;top:${NEW_TASK_BUTTON.y}px;width:${NEW_TASK_BUTTON.w}px">+ New task</div>
    <div class="abs side">
      <div class="nav"><span class="dot"></span>Inbox</div>
      <div class="nav on"><span class="dot"></span>Website relaunch</div>
      <div class="nav"><span class="dot"></span>Mobile app</div>
      <div class="nav"><span class="dot"></span>Marketing</div>
      <div class="nav"><span class="dot"></span>Archive</div>
    </div>`;

  const names = ['To do', 'In progress', 'Done'];
  const counts = [3 + (committed && !dropped ? 1 : 0), 2 + (dropped ? 1 : 0), 2];
  names.forEach((name, col) => {
    html += `<div class="abs colhead" style="left:${COLUMN_X[col]}px">${name}<span class="count">${counts[col]}</span></div>`;
    html += `<div class="abs lane" style="left:${COLUMN_X[col]}px"></div>`;
  });

  // To do: the new card sits on top once created, until it is dragged away.
  const newCardInTodo = draftVisible && !dragging && !dropped;
  const todoOffset = newCardInTodo || dragging ? 1 : 0;
  columns[0].forEach(([title, tag, avatar], i) => {
    html += card(
      title,
      tag,
      avatar,
      '',
      `left:${x0(0)}px;top:${CARD_TOP + 10 + (i + todoOffset) * slot}px`,
    );
  });
  const progressOffset = dragging && p.x > COLUMN_X[1] - 40 ? 1 : dropped ? 1 : 0;
  columns[1].forEach(([title, tag, avatar], i) => {
    html += card(
      title,
      tag,
      avatar,
      '',
      `left:${x0(1)}px;top:${CARD_TOP + 10 + (i + progressOffset) * slot}px`,
    );
  });
  columns[2].forEach(([title, tag, avatar], i) => {
    html += card(title, tag, avatar, '', `left:${x0(2)}px;top:${CARD_TOP + 10 + i * slot}px`);
  });

  const newTitle = typed.slice(0, typedCount);
  if (draftVisible && !committed) {
    const caretOn = Math.floor(t * 2.2) % 2 === 0 || (t >= T.typeStart && t < T.enter);
    const text = newTitle
      ? `<span>${newTitle}</span>`
      : `<span class="placeholder">Task name</span>`;
    html += `<div class="card abs" style="left:${x0(0)}px;top:${CARD_TOP + 10}px;padding:10px 6px">
      <div class="input">${newTitle ? text : ''}${caretOn ? '<span class="caret"></span>' : ''}${newTitle ? '' : text}</div>
      <div class="meta" style="margin-top:10px;padding:0 6px;font-size:12px;color:#7a8295">Press Enter to add</div></div>`;
  } else if (committed && !dragging && !dropped) {
    html += card(newTitle, 'launch', 1, '', `left:${x0(0)}px;top:${CARD_TOP + 10}px`);
  } else if (dragging) {
    const left = p.x - 150;
    const top = p.y - 40 + 10;
    html += card(newTitle, 'launch', 1, 'lifted', `left:${left}px;top:${top}px;z-index:5`);
  } else if (dropped) {
    html += card(newTitle, 'launch', 1, '', `left:${x0(1)}px;top:${CARD_TOP + 10}px`);
  }

  if (t >= T.shareUp) {
    const fade = Math.min(1, (t - T.shareUp) / 0.15);
    html += `<div class="abs toast" style="opacity:${fade};transform:translateY(${(1 - fade) * -6}px)">
      Link copied<small>Anyone with the link can view this board.</small></div>`;
  }

  document.getElementById('root').innerHTML = html;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error(
      'Playwright is not installed. Try: NODE_PATH=$(npm root -g) node ' + process.argv[1],
    );
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sample-frames-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: SCALE,
    });
    await page.setContent(PAGE_HTML);
    await page.evaluate(`window.renderAt = ${renderAt.toString()}`);
    await page.evaluate(() => document.fonts.ready);

    const layout = {
      COLUMN_X,
      COLUMN_W,
      CARD_TOP,
      CARD_H,
      CARD_GAP,
      SHARE_BUTTON,
      NEW_TASK_BUTTON,
    };
    const frameCount = DURATION * FPS;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const t = frame / FPS;
      const state = { t, p: cursorAt(t), layout, T, typed: TYPED_TEXT };
      await page.evaluate((s) => window.renderAt(s), state);
      await page.screenshot({
        path: path.join(frameDir, `${String(frame).padStart(4, '0')}.png`),
      });
    }
  } finally {
    await browser.close();
  }

  const videoPath = path.join(OUT_DIR, 'sample-project.mp4');
  execFileSync(
    FFMPEG,
    [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(FPS),
      '-i',
      path.join(frameDir, '%04d.png'),
      '-c:v',
      'libx264',
      '-preset',
      'veryslow',
      '-tune',
      'animation',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(FPS),
      '-movflags',
      '+faststart',
      videoPath,
    ],
    { stdio: 'inherit' },
  );
  fs.rmSync(frameDir, { recursive: true, force: true });

  const manifest = {
    version: 1,
    width: WIDTH,
    height: HEIGHT,
    duration: DURATION,
    events: buildEvents(),
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'sample-project.json'),
    `${JSON.stringify(manifest)}\n`,
    'utf8',
  );

  const size = fs.statSync(videoPath).size;
  console.log(`Wrote ${path.relative(ROOT, videoPath)} (${(size / 1024).toFixed(0)} KB)`);
  console.log(`Wrote ${manifest.events.length} input events`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
