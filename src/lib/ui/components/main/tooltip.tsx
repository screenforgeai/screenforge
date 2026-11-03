import {
  Tooltip as TooltipPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
  TooltipPortal as TooltipPortalPrimitive,
  TooltipContent as TooltipContentPrimitive,
  type TooltipProps as TooltipPrimitiveProps,
  type TooltipTriggerProps as TooltipTriggerPrimitiveProps,
  type TooltipContentProps as TooltipContentPrimitiveProps,
} from '../primitives/tooltip';
import { cn } from '../../../utils';

type TooltipProps = TooltipPrimitiveProps;

function Tooltip(props: TooltipProps) {
  return <TooltipPrimitive {...props} />;
}

type TooltipTriggerProps = TooltipTriggerPrimitiveProps;

function TooltipTrigger(props: TooltipTriggerProps) {
  return <TooltipTriggerPrimitive {...props} />;
}

type TooltipContentProps = TooltipContentPrimitiveProps;

function TooltipContent({
  className,
  sideOffset = 6,
  side = 'right',
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPortalPrimitive>
      <TooltipContentPrimitive
        side={side}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-md border border-sf-border bg-sf-bg px-2.5 py-1.5 text-xs text-sf-secondary shadow-md',
          className,
        )}
        {...props}
      />
    </TooltipPortalPrimitive>
  );
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipContentProps,
};
