import {
  Popover as PopoverPrimitive,
  PopoverAnchor as PopoverAnchorPrimitive,
  PopoverTrigger as PopoverTriggerPrimitive,
  PopoverContent as PopoverContentPrimitive,
  PopoverPortal as PopoverPortalPrimitive,
  PopoverClose as PopoverClosePrimitive,
  type PopoverProps as PopoverPrimitiveProps,
  type PopoverAnchorProps as PopoverAnchorPrimitiveProps,
  type PopoverTriggerProps as PopoverTriggerPrimitiveProps,
  type PopoverContentProps as PopoverContentPrimitiveProps,
  type PopoverCloseProps as PopoverClosePrimitiveProps,
} from '../primitives/popover';
import { cn } from 'src/lib/utils';

type PopoverProps = PopoverPrimitiveProps;

function Popover(props: PopoverProps) {
  return <PopoverPrimitive {...props} />;
}

type PopoverTriggerProps = PopoverTriggerPrimitiveProps;

function PopoverTrigger(props: PopoverTriggerProps) {
  return <PopoverTriggerPrimitive {...props} />;
}

type PopoverAnchorProps = PopoverAnchorPrimitiveProps;

function PopoverAnchor(props: PopoverAnchorProps) {
  return <PopoverAnchorPrimitive {...props} />;
}

type PopoverContentProps = PopoverContentPrimitiveProps;

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPortalPrimitive>
      <PopoverContentPrimitive
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden',
          className,
        )}
        {...props}
      />
    </PopoverPortalPrimitive>
  );
}

type PopoverCloseProps = PopoverClosePrimitiveProps;

function PopoverClose(props: PopoverCloseProps) {
  return <PopoverClosePrimitive {...props} />;
}

export {
  Popover,
  PopoverAnchor,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
  type PopoverProps,
  type PopoverAnchorProps,
  type PopoverTriggerProps,
  type PopoverContentProps,
  type PopoverCloseProps,
};
