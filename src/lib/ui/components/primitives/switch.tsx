'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from 'src/lib/utils';

const switchRootVariants = cva(
  'cursor-pointer peer inline-flex shrink-0 items-center rounded-full border border-white/6 bg-[#353535] outline-none transition-[background-color,border-color,box-shadow] duration-200 data-[state=checked]:border-[#2f513d] data-[state=checked]:bg-[#303030] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-70 focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b] shadow-[0_10px_24px_rgba(0,0,0,0.18)]',
  {
    variants: {
      size: {
        default: 'h-[36px] w-[66px] p-[4px]',
        sm: 'h-[24px] w-[44px] p-[3px]',
        xs: 'h-[18px] w-[32px] p-[2px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

const switchThumbVariants = cva(
  'block rounded-full bg-[#848484] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-transform duration-200 will-change-transform data-[state=unchecked]:translate-x-0 data-[state=checked]:bg-[#5dcf72] data-[state=checked]:shadow-[0_0_0_5px_rgba(93,207,114,0.08)]',
  {
    variants: {
      size: {
        default: 'size-[26px] data-[state=checked]:translate-x-[29px]',
        sm: 'size-[18px] data-[state=checked]:translate-x-[20px]',
        xs: 'size-[14px] data-[state=checked]:translate-x-[14px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

type SwitchSize = NonNullable<VariantProps<typeof switchRootVariants>['size']>;

const SwitchSizeContext = React.createContext<SwitchSize>('default');

type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> &
  VariantProps<typeof switchRootVariants>;

const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  ({ className, size = 'default', children, ...props }, ref) => (
    <SwitchSizeContext.Provider value={size ?? 'default'}>
      <SwitchPrimitive.Root
        ref={ref}
        className={cn(switchRootVariants({ size }), className)}
        {...props}
      >
        {children}
      </SwitchPrimitive.Root>
    </SwitchSizeContext.Provider>
  ),
);

Switch.displayName = SwitchPrimitive.Root.displayName;

type SwitchThumbProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Thumb>;

const SwitchThumb = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Thumb>,
  SwitchThumbProps
>(({ className, ...props }, ref) => {
  const size = React.useContext(SwitchSizeContext);
  return (
    <SwitchPrimitive.Thumb
      ref={ref}
      className={cn(switchThumbVariants({ size }), className)}
      {...props}
    />
  );
});

SwitchThumb.displayName = SwitchPrimitive.Thumb.displayName;

export { Switch, SwitchThumb, type SwitchProps, type SwitchSize };
