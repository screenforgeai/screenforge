'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

type TooltipProviderProps = React.ComponentProps<typeof TooltipPrimitive.Provider>;

function TooltipProvider({ delayDuration = 400, ...props }: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root>;

function Tooltip(props: TooltipProps) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

type TooltipTriggerProps = React.ComponentProps<typeof TooltipPrimitive.Trigger>;

function TooltipTrigger(props: TooltipTriggerProps) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

type TooltipPortalProps = React.ComponentProps<typeof TooltipPrimitive.Portal>;

function TooltipPortal(props: TooltipPortalProps) {
  return <TooltipPrimitive.Portal data-slot="tooltip-portal" {...props} />;
}

type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Content>;

function TooltipContent(props: TooltipContentProps) {
  return <TooltipPrimitive.Content data-slot="tooltip-content" {...props} />;
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipProvider,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipPortalProps,
  type TooltipContentProps,
  type TooltipProviderProps,
};
