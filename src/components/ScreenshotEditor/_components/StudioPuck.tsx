import { useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from 'src/lib/utils';

/** Id of the SVG "goo" filter (rendered once by {@link StudioGooFilter}). */
const GOO_FILTER_ID = 'sf-studio-goo';
const CHIP = 26;
/** How long the options stay after the pointer leaves, so a quick move to one never misses. */
const CLOSE_DELAY_MS = 220;

export type PuckSide = 'left' | 'right' | 'top' | 'bottom';

export type PuckAction = {
  id: string;
  side: PuckSide;
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

/**
 * The gooey blend behind the options: blurred shapes are cut back to a hard
 * edge, so where they overlap they merge like liquid and pull apart as the
 * options move out.
 */
export const StudioGooFilter = () => (
  <svg width="0" height="0" className="pointer-events-none absolute" aria-hidden>
    <defs>
      <filter id={GOO_FILTER_ID}>
        <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
        <feColorMatrix
          in="blur"
          mode="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
          result="goo"
        />
        <feComposite in="SourceGraphic" in2="goo" operator="atop" />
      </filter>
    </defs>
  </svg>
);

type Props = {
  /** Centre of the puck, in CSS pixels within the stage box. */
  x: number;
  y: number;
  /** Diameter of the puck itself. */
  size: number;
  actions: PuckAction[];
  /** First moments with a new screenshot: pulse and show the caption, so the puck is noticed. */
  intro: boolean;
  caption: string;
  /** The label of the option under the pointer, or null; shown as the readout. */
  onHoverAction: (label: string | null) => void;
  buttonRef?: Ref<HTMLButtonElement>;
  buttonProps: ButtonHTMLAttributes<HTMLButtonElement>;
  buttonClassName: string;
  children?: ReactNode;
};

/**
 * A handle on the studio canvas (the focus ring, the light). Hovering it grows
 * a soft blob that separates into a few round options around it.
 */
export const StudioPuck = ({
  x,
  y,
  size,
  actions,
  intro,
  caption,
  onHoverAction,
  buttonRef,
  buttonProps,
  buttonClassName,
  children,
}: Props) => {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      onHoverAction(null);
    }, CLOSE_DELAY_MS);
  };

  const reach = size / 2 + CHIP / 2 + 8;
  const offset = (side: PuckSide) =>
    ({ left: [-reach, 0], right: [reach, 0], top: [0, -reach], bottom: [0, reach] })[side];
  // The goo layer needs room for the whole flower: the filter only draws inside its own box.
  const box = 2 * (reach + CHIP);

  return (
    <div
      className="absolute"
      style={{ left: x, top: y }}
      onPointerEnter={show}
      onPointerLeave={hide}
    >
      <div
        className="pointer-events-none absolute opacity-80"
        style={{
          left: -box / 2,
          top: -box / 2,
          width: box,
          height: box,
          filter: `url(#${GOO_FILTER_ID})`,
        }}
      >
        <span
          className="absolute rounded-full bg-[#17181c] transition-transform duration-300 ease-out"
          style={{
            left: box / 2 - 15,
            top: box / 2 - 15,
            width: 30,
            height: 30,
            transform: `scale(${open ? 1 : 0})`,
          }}
        />
        {actions.map((action) => {
          const [dx, dy] = offset(action.side);
          return (
            <span
              key={action.id}
              className="absolute rounded-full bg-[#17181c] transition-transform duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
              style={{
                left: box / 2 - CHIP / 2,
                top: box / 2 - CHIP / 2,
                width: CHIP,
                height: CHIP,
                transform: open ? `translate(${dx}px, ${dy}px)` : 'translate(0, 0) scale(0.3)',
              }}
            />
          );
        })}
      </div>

      {actions.map((action) => {
        const [dx, dy] = offset(action.side);
        return (
          <button
            key={action.id}
            type="button"
            aria-label={action.label}
            tabIndex={open ? 0 : -1}
            className="absolute flex cursor-pointer items-center justify-center rounded-full text-white/85 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)] hover:text-white"
            style={{
              left: -CHIP / 2,
              top: -CHIP / 2,
              width: CHIP,
              height: CHIP,
              transform: open ? `translate(${dx}px, ${dy}px)` : 'translate(0, 0) scale(0.3)',
              opacity: open ? 1 : 0,
              pointerEvents: open ? 'auto' : 'none',
            }}
            onPointerEnter={() => onHoverAction(action.label)}
            onPointerLeave={() => onHoverAction(null)}
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {action.icon}
          </button>
        );
      })}

      <button
        ref={buttonRef}
        type="button"
        {...buttonProps}
        className={cn('absolute -translate-x-1/2 -translate-y-1/2', buttonClassName)}
        style={{ left: 0, top: 0, width: size, height: size, ...buttonProps.style }}
      >
        {children}
      </button>

      {intro && (
        <span
          className="pointer-events-none absolute animate-ping rounded-full border-2 border-white/70 [animation-iteration-count:2]"
          style={{ left: -size / 2, top: -size / 2, width: size, height: size }}
        />
      )}
      <span
        className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white transition-opacity duration-700"
        style={{ left: 0, top: size / 2 + 8, opacity: intro && !open ? 1 : 0 }}
      >
        {caption}
      </span>
    </div>
  );
};
