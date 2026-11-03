import { Spinner } from 'src/lib/ui';
import { cn } from 'src/lib/utils';

type ActivityIndicatorProps = {
  label: string;
  visible?: boolean;
  minWidthClassName?: string;
};

export const ActivityIndicator = ({
  label,
  visible = true,
  minWidthClassName = 'min-w-[104px]',
}: ActivityIndicatorProps) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'mr-2 flex items-center justify-end gap-1.5 text-base text-sf-secondary transition-all duration-200',
        minWidthClassName,
        visible
          ? 'translate-y-0 opacity-100 delay-150'
          : 'pointer-events-none -translate-y-1 opacity-0 delay-0',
      )}
    >
      <Spinner className="size-3.5 text-sf-border fill-sf-primary" />
      <span>{label}</span>
    </div>
  );
};
