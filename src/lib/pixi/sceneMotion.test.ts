import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { hasSceneMoved, readSceneMotion } from './sceneMotion';
import type { PixiScene } from './types';

const scene = () => {
  const cursor = new Container();
  const motionOverlayContainer = new Container();
  motionOverlayContainer.addChild(cursor);
  return {
    cursor,
    scene: {
      motionContainer: new Container(),
      compositeContainer: new Container(),
      cameraContainer: new Container(),
      frameContainer: new Container(),
      videoContainer: new Container(),
      motionOverlayContainer,
    } as unknown as PixiScene,
  };
};

describe('scene motion', () => {
  it('counts the first reading as movement', () => {
    const { scene: s } = scene();
    expect(hasSceneMoved(null, readSceneMotion(s))).toBe(true);
  });

  it('is at rest when nothing changed', () => {
    const { scene: s } = scene();
    expect(hasSceneMoved(readSceneMotion(s), readSceneMotion(s))).toBe(false);
  });

  it('sees the zoom camera still easing toward its target', () => {
    const { scene: s } = scene();
    const before = readSceneMotion(s);
    s.cameraContainer.pivot.x += 0.5;
    expect(hasSceneMoved(before, readSceneMotion(s))).toBe(true);
  });

  it('sees a later clip still fading in (wall-clock fade on the video container)', () => {
    const { scene: s } = scene();
    const before = readSceneMotion(s);
    s.videoContainer.alpha = 0.4;
    expect(hasSceneMoved(before, readSceneMotion(s))).toBe(true);
  });

  it('sees the cursor moving', () => {
    const { scene: s, cursor } = scene();
    const before = readSceneMotion(s);
    cursor.position.y += 2;
    expect(hasSceneMoved(before, readSceneMotion(s))).toBe(true);
  });

  it('ignores changes far below a pixel', () => {
    const { scene: s } = scene();
    const before = readSceneMotion(s);
    s.cameraContainer.position.x += 1e-6;
    expect(hasSceneMoved(before, readSceneMotion(s))).toBe(false);
  });
});
