import {
  DropdownMenu as DropdownMenuPrimitive,
  DropdownMenuContent as DropdownMenuContentPrimitive,
  DropdownMenuGroup as DropdownMenuGroupPrimitive,
  DropdownMenuHighlightItem as DropdownMenuHighlightItemPrimitive,
  DropdownMenuHighlight as DropdownMenuHighlightPrimitive,
  DropdownMenuItem as DropdownMenuItemPrimitive,
  DropdownMenuItemIndicator as DropdownMenuItemIndicatorPrimitive,
  DropdownMenuCheckboxItem as DropdownMenuCheckboxItemPrimitive,
  DropdownMenuRadioGroup as DropdownMenuRadioGroupPrimitive,
  DropdownMenuRadioItem as DropdownMenuRadioItemPrimitive,
  DropdownMenuLabel as DropdownMenuLabelPrimitive,
  DropdownMenuSeparator as DropdownMenuSeparatorPrimitive,
  DropdownMenuShortcut as DropdownMenuShortcutPrimitive,
  DropdownMenuSub as DropdownMenuSubPrimitive,
  DropdownMenuSubContent as DropdownMenuSubContentPrimitive,
  DropdownMenuSubTrigger as DropdownMenuSubTriggerPrimitive,
  DropdownMenuTrigger as DropdownMenuTriggerPrimitive,
  type DropdownMenuProps as DropdownMenuPrimitiveProps,
  type DropdownMenuContentProps as DropdownMenuContentPrimitiveProps,
  type DropdownMenuGroupProps as DropdownMenuGroupPrimitiveProps,
  type DropdownMenuItemProps as DropdownMenuItemPrimitiveProps,
  type DropdownMenuCheckboxItemProps as DropdownMenuCheckboxItemPrimitiveProps,
  type DropdownMenuRadioGroupProps as DropdownMenuRadioGroupPrimitiveProps,
  type DropdownMenuRadioItemProps as DropdownMenuRadioItemPrimitiveProps,
  type DropdownMenuLabelProps as DropdownMenuLabelPrimitiveProps,
  type DropdownMenuSeparatorProps as DropdownMenuSeparatorPrimitiveProps,
  type DropdownMenuShortcutProps as DropdownMenuShortcutPrimitiveProps,
  type DropdownMenuSubProps as DropdownMenuSubPrimitiveProps,
  type DropdownMenuSubContentProps as DropdownMenuSubContentPrimitiveProps,
  type DropdownMenuSubTriggerProps as DropdownMenuSubTriggerPrimitiveProps,
  type DropdownMenuTriggerProps as DropdownMenuTriggerPrimitiveProps,
} from '../primitives/dropdown-menu';
import { cn } from '../../../utils';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';

type DropdownMenuProps = DropdownMenuPrimitiveProps;

function DropdownMenu(props: DropdownMenuProps) {
  return <DropdownMenuPrimitive {...props} />;
}

type DropdownMenuTriggerProps = DropdownMenuTriggerPrimitiveProps;

function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
  return <DropdownMenuTriggerPrimitive {...props} />;
}

type DropdownMenuContentProps = DropdownMenuContentPrimitiveProps;

function DropdownMenuContent({
  sideOffset = 4,
  className,
  children,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuContentPrimitive
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-sf-border bg-sf-panel/95 p-1.5 text-sf-primary shadow-[0_1px_1px_rgba(0,0,0,0.2),0_12px_32px_rgba(0,0,0,0.3)] outline-none backdrop-blur-xl',
        className,
      )}
      {...props}
    >
      <DropdownMenuHighlightPrimitive className="absolute inset-0 z-0 rounded-md bg-[#1a1a20]">
        {children}
      </DropdownMenuHighlightPrimitive>
    </DropdownMenuContentPrimitive>
  );
}

type DropdownMenuGroupProps = DropdownMenuGroupPrimitiveProps;

function DropdownMenuGroup({ ...props }: DropdownMenuGroupProps) {
  return <DropdownMenuGroupPrimitive {...props} />;
}

type DropdownMenuItemProps = DropdownMenuItemPrimitiveProps & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
};

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  disabled,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuHighlightItemPrimitive
      activeClassName={variant === 'destructive' ? 'bg-destructive/10 dark:bg-destructive/20' : ''}
      disabled={disabled}
    >
      <DropdownMenuItemPrimitive
        disabled={disabled}
        data-inset={inset}
        data-variant={variant}
        className={cn(
          "relative z-10 flex cursor-pointer select-none items-center gap-2.5 rounded-md px-3 py-2 text-md tracking-[-0.01em] text-sf-primary outline-hidden data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[inset]:pl-9 data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className,
        )}
        {...props}
      />
    </DropdownMenuHighlightItemPrimitive>
  );
}

type DropdownMenuCheckboxItemProps = DropdownMenuCheckboxItemPrimitiveProps;

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  disabled,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenuHighlightItemPrimitive disabled={disabled}>
      <DropdownMenuCheckboxItemPrimitive
        disabled={disabled}
        className={cn(
          "relative z-10 flex cursor-pointer select-none items-center gap-2.5 rounded-md px-3 py-2 pl-9 text-md tracking-[-0.01em] text-sf-primary outline-hidden data-[state=checked]:bg-[#17171c] data-[state=checked]:font-medium data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className,
        )}
        checked={checked}
        {...props}
      >
        <span className="pointer-events-none absolute left-3 flex h-4 w-4 items-center justify-center text-primary">
          <DropdownMenuItemIndicatorPrimitive
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <CheckIcon className="size-4" />
          </DropdownMenuItemIndicatorPrimitive>
        </span>
        {children}
      </DropdownMenuCheckboxItemPrimitive>
    </DropdownMenuHighlightItemPrimitive>
  );
}

type DropdownMenuRadioGroupProps = DropdownMenuRadioGroupPrimitiveProps;

function DropdownMenuRadioGroup(props: DropdownMenuRadioGroupProps) {
  return <DropdownMenuRadioGroupPrimitive {...props} />;
}

type DropdownMenuRadioItemProps = DropdownMenuRadioItemPrimitiveProps;

function DropdownMenuRadioItem({
  className,
  children,
  disabled,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <DropdownMenuHighlightItemPrimitive disabled={disabled}>
      <DropdownMenuRadioItemPrimitive
        disabled={disabled}
        className={cn(
          "relative z-10 flex cursor-pointer select-none items-center gap-2.5 rounded-md px-3 py-2 pl-9 text-md tracking-[-0.01em] text-sf-primary outline-hidden data-[state=checked]:bg-[#17171c] data-[state=checked]:font-medium data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className,
        )}
        {...props}
      >
        <span className="pointer-events-none absolute left-3 flex h-4 w-4 items-center justify-center text-primary">
          <DropdownMenuItemIndicatorPrimitive>
            <CheckIcon className="size-4" />
          </DropdownMenuItemIndicatorPrimitive>
        </span>
        {children}
      </DropdownMenuRadioItemPrimitive>
    </DropdownMenuHighlightItemPrimitive>
  );
}

type DropdownMenuLabelProps = DropdownMenuLabelPrimitiveProps & {
  inset?: boolean;
};

function DropdownMenuLabel({ className, inset, ...props }: DropdownMenuLabelProps) {
  return (
    <DropdownMenuLabelPrimitive
      data-inset={inset}
      className={cn(
        'px-3 py-2 pl-9 text-xs font-semibold uppercase tracking-[0.08em] text-sf-secondary/85 data-[inset]:pl-9',
        className,
      )}
      {...props}
    />
  );
}

type DropdownMenuSeparatorProps = DropdownMenuSeparatorPrimitiveProps;

function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return (
    <DropdownMenuSeparatorPrimitive
      className={cn('-mx-1 my-1.5 h-px bg-sf-border', className)}
      {...props}
    />
  );
}

type DropdownMenuShortcutProps = DropdownMenuShortcutPrimitiveProps;

function DropdownMenuShortcut({ className, ...props }: DropdownMenuShortcutProps) {
  return (
    <DropdownMenuShortcutPrimitive
      className={cn('text-muted-foreground ml-auto text-xs tracking-widest', className)}
      {...props}
    />
  );
}

type DropdownMenuSubProps = DropdownMenuSubPrimitiveProps;

function DropdownMenuSub(props: DropdownMenuSubProps) {
  return <DropdownMenuSubPrimitive {...props} />;
}

type DropdownMenuSubTriggerProps = DropdownMenuSubTriggerPrimitiveProps & {
  inset?: boolean;
};

function DropdownMenuSubTrigger({
  disabled,
  className,
  inset,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <DropdownMenuHighlightItemPrimitive disabled={disabled}>
      <DropdownMenuSubTriggerPrimitive
        disabled={disabled}
        data-inset={inset}
        className={cn(
          'focus:text-accent-foreground data-[state=open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8',
          'data-[state=open]:[&_[data-slot=chevron]]:rotate-90 [&_[data-slot=chevron]]:transition-transform [&_[data-slot=chevron]]:duration-300 [&_[data-slot=chevron]]:ease-in-out',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronRightIcon data-slot="chevron" className="ml-auto size-4" />
      </DropdownMenuSubTriggerPrimitive>
    </DropdownMenuHighlightItemPrimitive>
  );
}

type DropdownMenuSubContentProps = DropdownMenuSubContentPrimitiveProps;

function DropdownMenuSubContent({ className, ...props }: DropdownMenuSubContentProps) {
  return (
    <DropdownMenuSubContentPrimitive
      className={cn(
        'bg-popover text-popover-foreground z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md border p-1 shadow-lg outline-none',
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  type DropdownMenuProps,
  type DropdownMenuTriggerProps,
  type DropdownMenuContentProps,
  type DropdownMenuGroupProps,
  type DropdownMenuItemProps,
  type DropdownMenuCheckboxItemProps,
  type DropdownMenuRadioGroupProps,
  type DropdownMenuRadioItemProps,
  type DropdownMenuLabelProps,
  type DropdownMenuSeparatorProps,
  type DropdownMenuShortcutProps,
  type DropdownMenuSubProps,
  type DropdownMenuSubTriggerProps,
  type DropdownMenuSubContentProps,
};
