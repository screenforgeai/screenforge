import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { motion } from 'motion/react';

import { cn } from '../../../utils';

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const MotionSelectTrigger = motion.create(SelectPrimitive.Trigger);

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, disabled, ...props }, ref) => (
  <MotionSelectTrigger
    ref={ref}
    disabled={disabled}
    transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
    className={cn(
      'cursor-pointer relative flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3.5 py-2 text-md font-medium tracking-[-0.01em] text-sf-primary shadow-xs outline-none transition-[border-color,background-color,box-shadow,color] duration-150 ease-out dark:bg-input/30 data-placeholder:text-sf-muted hover:border-sf-border-lt hover:bg-sf-panel/70 hover:text-sf-primary focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-sf-border-lt data-[state=open]:bg-sf-panel data-[state=open]:shadow-[0_1px_1px_rgba(0,0,0,0.12),0_10px_24px_rgba(0,0,0,0.18)] [&>span]:line-clamp-1 [&>span]:pr-2 [&[data-state=open]_[data-slot=select-icon]]:rotate-180 [&[data-state=open]_[data-slot=select-icon]]:text-sf-primary',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown
        data-slot="select-icon"
        className="h-4 w-4 shrink-0 text-sf-secondary transition-transform duration-200 ease-out"
      />
    </SelectPrimitive.Icon>
  </MotionSelectTrigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      'flex h-7 cursor-default items-center justify-center rounded-t-lg text-sf-secondary',
      className,
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      'flex h-7 cursor-default items-center justify-center rounded-b-lg text-sf-secondary',
      className,
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-lg border border-sf-border bg-sf-panel/95 text-sf-primary shadow-[0_1px_1px_rgba(0,0,0,0.2),0_12px_32px_rgba(0,0,0,0.3)] backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className,
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1.5',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      'px-3 py-2 pl-9 text-md font-semibold capitalize text-sf-secondary/85',
      className,
    )}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

type SelectItemProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
  /** Rendered at the end of the row, outside the item text shown in the trigger (e.g. a preview button). */
  endAdornment?: React.ReactNode;
};

const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, SelectItemProps>(
  ({ className, children, endAdornment, ...props }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'cursor-pointer relative flex w-full select-none items-center rounded-md px-3 py-2 pl-9 text-md tracking-[-0.01em] text-sf-primary outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-[highlighted]:bg-[#1a1a20] data-[highlighted]:text-sf-primary data-[state=checked]:bg-[#17171c] data-[state=checked]:font-medium data-[state=checked]:text-sf-primary',
        className,
      )}
      {...props}
    >
      <span className="absolute left-3 flex h-4 w-4 items-center justify-center text-primary">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {endAdornment ? <span className="ml-auto flex items-center pl-2">{endAdornment}</span> : null}
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1.5 h-px bg-sf-border', className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
