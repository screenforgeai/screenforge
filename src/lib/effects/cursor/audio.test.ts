import { describe, expect, it } from 'vitest';
import {
  CLICK_SOUND_OPTIONS,
  buildClickSoundHits,
  normalizeCursorClickSound,
  scheduleCursorClickSound,
} from './audio';

/* ── Minimal Web Audio fake: records what gets scheduled ─────────────────── */

type Started = { kind: 'oscillator' | 'noise'; when: number; frequency?: number };

function createFakeContext() {
  const started: Started[] = [];
  type FakeParam = {
    value: number;
    setValueAtTime: (value: number) => FakeParam;
    linearRampToValueAtTime: () => FakeParam;
    exponentialRampToValueAtTime: () => FakeParam;
    setTargetAtTime: () => FakeParam;
  };
  const param = (): FakeParam => {
    const p: FakeParam = {
      value: 0,
      setValueAtTime: (value) => {
        p.value = value;
        return p;
      },
      linearRampToValueAtTime: () => p,
      exponentialRampToValueAtTime: () => p,
      setTargetAtTime: () => p,
    };
    return p;
  };
  const node = () => ({
    connect: (): undefined => undefined,
    disconnect: (): undefined => undefined,
  });
  const context = {
    sampleRate: 48_000,
    currentTime: 0,
    destination: node(),
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource: () => ({
      ...node(),
      buffer: null as unknown,
      onended: null as unknown,
      start: (when: number): void => {
        started.push({ kind: 'noise', when });
      },
      stop: (): undefined => undefined,
    }),
    createOscillator: () => {
      const frequency = param();
      return {
        ...node(),
        type: 'sine',
        frequency,
        onended: null as unknown,
        start: (when: number): void => {
          started.push({ kind: 'oscillator', when, frequency: frequency.value });
        },
        stop: (): undefined => undefined,
      };
    },
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
  };
  return { context: context as unknown as AudioContext, started };
}

describe('normalizeCursorClickSound', () => {
  it('keeps every current option', () => {
    for (const option of CLICK_SOUND_OPTIONS) {
      expect(normalizeCursorClickSound(option)).toBe(option);
    }
  });

  it('maps the removed presets to their closest replacement', () => {
    expect(normalizeCursorClickSound('magic-mouse')).toBe('trackpad');
    expect(normalizeCursorClickSound('mx-master')).toBe('mouse');
  });

  it('falls back to none for unknown values', () => {
    expect(normalizeCursorClickSound('laser')).toBe('none');
    expect(normalizeCursorClickSound(undefined)).toBe('none');
    expect(normalizeCursorClickSound(42)).toBe('none');
  });
});

describe('CLICK_SOUND_OPTIONS', () => {
  it('lists none first, then mouse and trackpad, then the rest', () => {
    expect(CLICK_SOUND_OPTIONS).toEqual(['none', 'mouse', 'trackpad', 'soft', 'pop', 'tick']);
  });
});

describe('buildClickSoundHits', () => {
  it('pairs each click with the mouse-up that follows it', () => {
    const hits = buildClickSoundHits(
      [{ t: 1 }, { t: 2 }],
      [
        { t: 1, isDown: true },
        { t: 1.09, isDown: false },
        { t: 2, isDown: true },
        { t: 2.12, isDown: false },
      ],
    );

    expect(hits).toEqual([
      { t: 1, release: false, index: 0 },
      { t: 1.09, release: true, index: 0 },
      { t: 2, release: false, index: 1 },
      { t: 2.12, release: true, index: 1 },
    ]);
  });

  it('keeps hits sorted when a drag releases after the next click', () => {
    const hits = buildClickSoundHits(
      [{ t: 1 }, { t: 1.5 }],
      [
        { t: 1, isDown: true },
        { t: 1.5, isDown: true },
        { t: 1.6, isDown: false },
        { t: 3, isDown: false },
      ],
    );

    expect(hits.map((hit) => hit.t)).toEqual([1, 1.5, 1.6, 3]);
    expect(hits.find((hit) => hit.t === 1.6)?.index).toBe(0);
    expect(hits.find((hit) => hit.t === 3)?.index).toBe(1);
  });

  it('skips a release that lands right on its press, as with tap-to-click', () => {
    const hits = buildClickSoundHits(
      [{ t: 1 }, { t: 2 }],
      [
        { t: 1, isDown: true },
        { t: 1.004, isDown: false },
        { t: 2, isDown: true },
        { t: 2.09, isDown: false },
      ],
    );

    expect(hits).toEqual([
      { t: 1, release: false, index: 0 },
      { t: 2, release: false, index: 1 },
      { t: 2.09, release: true, index: 1 },
    ]);
  });

  it('skips the release when no mouse-up was recorded', () => {
    const hits = buildClickSoundHits([{ t: 1 }], [{ t: 1, isDown: true }]);
    expect(hits).toEqual([{ t: 1, release: false, index: 0 }]);
  });

  it('ignores a mouse-up that came before the click', () => {
    const hits = buildClickSoundHits(
      [{ t: 1 }],
      [
        { t: 0.5, isDown: false },
        { t: 1, isDown: true },
      ],
    );
    expect(hits).toEqual([{ t: 1, release: false, index: 0 }]);
  });

  it('works without press events', () => {
    expect(buildClickSoundHits([{ t: 0.4 }], undefined)).toEqual([
      { t: 0.4, release: false, index: 0 },
    ]);
  });
});

describe('scheduleCursorClickSound', () => {
  it('schedules nothing for none or zero volume', () => {
    const { context, started } = createFakeContext();
    scheduleCursorClickSound(context, 'none', 1, 0.5);
    scheduleCursorClickSound(context, 'soft', 0, 0.5);
    expect(started).toHaveLength(0);
  });

  it('schedules every layer of a press at the requested time', () => {
    const { context, started } = createFakeContext();
    scheduleCursorClickSound(context, 'mouse', 0.5, 1.25);
    expect(started.length).toBeGreaterThan(1);
    expect(started.every((s) => s.when === 1.25)).toBe(true);
  });

  it('plays a release for sounds that have one', () => {
    const { context, started } = createFakeContext();
    scheduleCursorClickSound(context, 'mouse', 0.5, 2, context.destination, {
      release: true,
      index: 0,
    });
    expect(started.length).toBeGreaterThan(0);
  });

  it('skips the release for sounds without one', () => {
    const { context, started } = createFakeContext();
    scheduleCursorClickSound(context, 'pop', 0.5, 2, context.destination, {
      release: true,
      index: 0,
    });
    scheduleCursorClickSound(context, 'tick', 0.5, 2, context.destination, {
      release: true,
      index: 0,
    });
    expect(started).toHaveLength(0);
  });

  it('varies pitch between clicks but repeats it exactly for the same click', () => {
    const pitches = (index: number) => {
      const { context, started } = createFakeContext();
      scheduleCursorClickSound(context, 'tick', 1, 0, context.destination, { index });
      return started.filter((s) => s.kind === 'oscillator').map((s) => s.frequency);
    };

    expect(pitches(3)).toEqual(pitches(3));
    expect(pitches(3)).not.toEqual(pitches(4));
  });

  it('raises the release pitch above the press', () => {
    const firstOscillator = (release: boolean) => {
      const { context, started } = createFakeContext();
      scheduleCursorClickSound(context, 'trackpad', 1, 0, context.destination, {
        release,
        index: 7,
      });
      return started.find((s) => s.kind === 'oscillator')?.frequency ?? 0;
    };

    expect(firstOscillator(true)).toBeGreaterThan(firstOscillator(false));
  });
});
