import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from 'src/lib/utils';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('flex flex-col gap-0.5', className)} {...props} />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-sf-secondary outline-none transition-colors',
      'hover:bg-secondary/60 hover:text-sf-primary',
      'data-[state=active]:bg-secondary data-[state=active]:text-sf-primary',
      'disabled:pointer-events-none disabled:opacity-50',
      '[&>[data-tab-icon]]:text-sf-muted data-[state=active]:[&>[data-tab-icon]]:text-sf-secondary',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('flex flex-1 flex-col outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
