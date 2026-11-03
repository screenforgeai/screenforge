import {
  AlertDialog as AlertDialogPrimitive,
  AlertDialogContent as AlertDialogContentPrimitive,
  AlertDialogDescription as AlertDialogDescriptionPrimitive,
  AlertDialogFooter as AlertDialogFooterPrimitive,
  AlertDialogHeader as AlertDialogHeaderPrimitive,
  AlertDialogTitle as AlertDialogTitlePrimitive,
  AlertDialogTrigger as AlertDialogTriggerPrimitive,
  AlertDialogPortal as AlertDialogPortalPrimitive,
  AlertDialogOverlay as AlertDialogOverlayPrimitive,
  AlertDialogAction as AlertDialogActionPrimitive,
  AlertDialogCancel as AlertDialogCancelPrimitive,
  type AlertDialogProps as AlertDialogPrimitiveProps,
  type AlertDialogContentProps as AlertDialogContentPrimitiveProps,
  type AlertDialogDescriptionProps as AlertDialogDescriptionPrimitiveProps,
  type AlertDialogFooterProps as AlertDialogFooterPrimitiveProps,
  type AlertDialogHeaderProps as AlertDialogHeaderPrimitiveProps,
  type AlertDialogTitleProps as AlertDialogTitlePrimitiveProps,
  type AlertDialogTriggerProps as AlertDialogTriggerPrimitiveProps,
  type AlertDialogOverlayProps as AlertDialogOverlayPrimitiveProps,
  type AlertDialogActionProps as AlertDialogActionPrimitiveProps,
  type AlertDialogCancelProps as AlertDialogCancelPrimitiveProps,
} from 'src/lib/ui/components/primitives/alert-dialog';
import { cn } from 'src/lib/utils';
import { buttonVariants } from './button';

type AlertDialogProps = AlertDialogPrimitiveProps;

function AlertDialog(props: AlertDialogProps) {
  return <AlertDialogPrimitive {...props} />;
}

type AlertDialogTriggerProps = AlertDialogTriggerPrimitiveProps;

function AlertDialogTrigger(props: AlertDialogTriggerProps) {
  return <AlertDialogTriggerPrimitive {...props} />;
}

type AlertDialogOverlayProps = AlertDialogOverlayPrimitiveProps;

function AlertDialogOverlay({ className, ...props }: AlertDialogOverlayProps) {
  return (
    <AlertDialogOverlayPrimitive
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  );
}

type AlertDialogContentProps = AlertDialogContentPrimitiveProps;

function AlertDialogContent({ className, ...props }: AlertDialogContentProps) {
  return (
    <AlertDialogPortalPrimitive>
      <AlertDialogOverlay />
      <AlertDialogContentPrimitive
        className={cn(
          'bg-sf-panel border-sf-border text-sf-primary fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg sm:max-w-lg',
          className,
        )}
        {...props}
      />
    </AlertDialogPortalPrimitive>
  );
}

type AlertDialogHeaderProps = AlertDialogHeaderPrimitiveProps;

function AlertDialogHeader({ className, ...props }: AlertDialogHeaderProps) {
  return (
    <AlertDialogHeaderPrimitive
      className={cn('flex flex-col gap-1 text-center sm:text-left', className)}
      {...props}
    />
  );
}

type AlertDialogFooterProps = AlertDialogFooterPrimitiveProps;

function AlertDialogFooter({ className, ...props }: AlertDialogFooterProps) {
  return (
    <AlertDialogFooterPrimitive
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

type AlertDialogTitleProps = AlertDialogTitlePrimitiveProps;

function AlertDialogTitle({ className, ...props }: AlertDialogTitleProps) {
  return (
    <AlertDialogTitlePrimitive className={cn('text-lg font-semibold', className)} {...props} />
  );
}

type AlertDialogDescriptionProps = AlertDialogDescriptionPrimitiveProps;

function AlertDialogDescription({ className, ...props }: AlertDialogDescriptionProps) {
  return (
    <AlertDialogDescriptionPrimitive
      className={cn('text-sf-secondary text-md', className)}
      {...props}
    />
  );
}

type AlertDialogActionProps = AlertDialogActionPrimitiveProps;

function AlertDialogAction({ className, ...props }: AlertDialogActionPrimitiveProps) {
  return <AlertDialogActionPrimitive className={cn(buttonVariants(), className)} {...props} />;
}

type AlertDialogCancelProps = AlertDialogCancelPrimitiveProps;

function AlertDialogCancel({ className, ...props }: AlertDialogCancelPrimitiveProps) {
  return (
    <AlertDialogCancelPrimitive
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  type AlertDialogProps,
  type AlertDialogTriggerProps,
  type AlertDialogContentProps,
  type AlertDialogHeaderProps,
  type AlertDialogFooterProps,
  type AlertDialogTitleProps,
  type AlertDialogDescriptionProps,
  type AlertDialogActionProps,
  type AlertDialogCancelProps,
};
