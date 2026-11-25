import { useEffect, useLayoutEffect, useRef } from 'react';

type Spring = {
  k: number;
  d: number;
  x: number | null;
  v: number;
  target: number;
  raf: number;
  last: number;
};

const DOT = 8;
const STEP = 16; // 8px dot + 8px gap

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One white dot travels between the step dots. Its two edges are separate
 * springs: the leading edge snaps, the trailing edge follows, so it stretches
 * a little in transit and settles. Placed instantly on first render.
 */
export const useTravellingDot = (index: number) => {
  const ref = useRef<HTMLSpanElement>(null);
  const edges = useRef({ a: 0, b: DOT });
  // The two edge springs, mutated in place by the animation frames.
  const springs = useRef<{ a: Spring; b: Spring } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!springs.current) {
      const make = (): Spring => ({ k: 760, d: 44, x: null, v: 0, target: 0, raf: 0, last: 0 });
      springs.current = { a: make(), b: make() };
    }
    const pair = springs.current;
    if (!el) {
      return;
    }

    const paint = () => {
      const { a, b } = edges.current;
      el.style.transform = `translateX(${a}px)`;
      el.style.width = `${Math.max(DOT, b - a)}px`;
    };

    const run = (spring: Spring, key: 'a' | 'b', target: number, instant: boolean) => {
      spring.target = target;
      if (spring.x === null || instant) {
        cancelAnimationFrame(spring.raf);
        spring.raf = 0;
        spring.x = target;
        spring.v = 0;
        edges.current[key] = target;
        paint();
        return;
      }
      const step = (time: number) => {
        const dt = Math.min(0.032, (time - spring.last) / 1000);
        spring.last = time;
        // Fixed substeps keep it the same at any frame rate.
        for (let i = 0; i < 4; i++) {
          const h = dt / 4;
          const x = spring.x ?? spring.target;
          const accel = -spring.k * (x - spring.target) - spring.d * spring.v;
          spring.v += accel * h;
          spring.x = x + spring.v * h;
        }
        const x = spring.x ?? spring.target;
        if (Math.abs(spring.v) < 0.02 && Math.abs(x - spring.target) < 0.02) {
          spring.x = spring.target;
          spring.v = 0;
          spring.raf = 0;
          edges.current[key] = spring.target;
          paint();
          return;
        }
        edges.current[key] = x;
        paint();
        spring.raf = requestAnimationFrame(step);
      };
      if (!spring.raf) {
        spring.last = performance.now();
        spring.raf = requestAnimationFrame(step);
      }
    };

    const nextA = index * STEP;
    const nextB = nextA + DOT;
    const instant = pair.a.x === null || prefersReducedMotion();
    const forward = pair.a.x === null || nextA > pair.a.x;
    const [lead, trail] = forward ? [pair.b, pair.a] : [pair.a, pair.b];
    lead.k = 760;
    lead.d = 44;
    trail.k = 300;
    trail.d = 30;
    run(pair.a, 'a', nextA, instant);
    run(pair.b, 'b', nextB, instant);
  }, [index]);

  useEffect(() => {
    const current = springs;
    return () => {
      if (current.current) {
        cancelAnimationFrame(current.current.a.raf);
        cancelAnimationFrame(current.current.b.raf);
      }
    };
  }, []);

  return ref;
};
