import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '../../../utils';

const DOT_COUNT = 13;

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  inlineLabel?: string;
  valueLabel?: string;
  formatValue?: (value: number) => string;
};

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  (
    {
      className,
      defaultValue,
      formatValue,
      inlineLabel,
      max = 100,
      min = 0,
      value,
      valueLabel,
      onPointerDown,
      onValueCommit,
      ...props
    },
    ref,
  ) => {
    const [isHovered, setIsHovered] = React.useState(false);
    const [isDragging, setIsDragging] = React.useState(false);

    const currentValue = value?.[0] ?? defaultValue?.[0] ?? min;
    const safeRange = max - min || 1;
    const progress = Math.min(Math.max(((currentValue - min) / safeRange) * 100, 0), 100);
    const resolvedValueLabel = valueLabel ?? (formatValue ? formatValue(currentValue) : undefined);

    const interactive = isHovered || isDragging;
    const fillWidth = progress <= 0 ? '0%' : progress >= 100 ? '100%' : `calc(${progress}% + 8px)`;

    return (
      <SliderPrimitive.Root
        ref={ref}
        min={min}
        max={max}
        value={value}
        defaultValue={defaultValue}
        onPointerDown={(e) => {
          setIsDragging(true);
          onPointerDown?.(e);
        }}
        onPointerUp={() => setIsDragging(false)}
        onPointerLeave={() => setIsDragging(false)}
        onValueCommit={(v) => {
          setIsDragging(false);
          onValueCommit?.(v);
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          setIsDragging(false);
        }}
        className={cn(
          'relative flex h-10 w-full touch-none select-none items-center rounded-full',
          'border border-white/6 bg-[#111112]',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
          'cursor-pointer',
          className,
        )}
        {...props}
      >
        {/* Value tooltip — above thumb while dragging */}
        {resolvedValueLabel && (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute z-30 -translate-x-1/2 -top-8',
              'rounded-md bg-[#242428] px-2 py-0.5',
              'text-xs font-medium tabular-nums text-white/85',
              'shadow-[0_2px_8px_rgba(0,0,0,0.5)]',
              'transition-opacity duration-150 ease-out',
              isDragging ? 'opacity-100' : 'opacity-0',
            )}
            style={{ left: `${progress}%` }}
          >
            {resolvedValueLabel}
          </div>
        )}

        <SliderPrimitive.Track className="relative h-full w-full flex items-center overflow-hidden rounded-full">
          <SliderPrimitive.Range className="absolute bg-transparent" />

          {/* Progress fill */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[#32323b] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[width] duration-150 ease-out"
            style={{ width: fillWidth }}
          />

          {/* Dot markers — appear on hover / drag */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 flex items-center justify-between px-3.5',
              'transition-opacity duration-150',
              interactive ? 'opacity-100' : 'opacity-0',
            )}
          >
            {Array.from({ length: DOT_COUNT }).map((_, i) => (
              <div key={i} className="h-[3px] w-[3px] shrink-0 rounded-full bg-white/20" />
            ))}
          </div>

          {/* Label — always visible, left */}
          {inlineLabel && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-3.5 z-10 select-none text-md font-medium tracking-[-0.02em] text-white/85"
            >
              {inlineLabel}
            </span>
          )}

          {/* Value right — visible at rest, fades on hover/drag */}
          {resolvedValueLabel && (
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute right-3.5 z-10 select-none',
                'tabular-nums text-[13px] tracking-[-0.01em] text-white/50',
                'transition-opacity duration-150',
                interactive ? 'opacity-0' : 'opacity-100',
              )}
            >
              {resolvedValueLabel}
            </span>
          )}
        </SliderPrimitive.Track>

        {/* Thumb — invisible → thin bar → pill */}
        <SliderPrimitive.Thumb
          className={cn(
            'relative z-20 block rounded-full focus-visible:outline-none',
            'disabled:pointer-events-none',
            'transition-[width,height,opacity,box-shadow] duration-150 ease-out',
            isDragging
              ? 'h-6 w-1.5 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.4)]'
              : isHovered
                ? 'h-[22px] w-[2px] bg-white/65'
                : 'h-2 w-[2px] opacity-0',
          )}
        />
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
