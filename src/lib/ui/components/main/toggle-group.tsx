import { type VariantProps } from 'class-variance-authority';

import {
  ToggleGroup as ToggleGroupPrimitive,
  ToggleGroupItem as ToggleGroupItemPrimitive,
  ToggleGroupHighlight as ToggleGroupHighlightPrimitive,
  ToggleGroupHighlightItem as ToggleGroupHighlightItemPrimitive,
  useToggleGroup as useToggleGroupPrimitive,
  type ToggleGroupProps as ToggleGroupPrimitiveProps,
  type ToggleGroupItemProps as ToggleGroupItemPrimitiveProps,
} from 'src/lib/ui/components/primitives/toggle-group';
import { toggleVariants } from 'src/lib/ui/components/main/toggle';
import { cn } from 'src/lib/utils';
import { getStrictContext } from 'src/lib/get-strict-context';

const [ToggleGroupProvider, useToggleGroup] =
  getStrictContext<VariantProps<typeof toggleVariants>>('ToggleGroupContext');

type ToggleGroupProps = ToggleGroupPrimitiveProps &
  VariantProps<typeof toggleVariants> & {
    framed?: boolean;
    highlightClassName?: string;
  };

function ToggleGroup({
  className,
  variant,
  size,
  children,
  framed = true,
  highlightClassName,
  ...props
}: ToggleGroupProps) {
  return (
    <ToggleGroupPrimitive
      data-variant={variant}
      data-size={size}
      className={cn(
        'group/toggle-group flex gap-0.5 w-fit items-center rounded-lg',
        framed && 'border border-sf-border bg-[#141416] p-0.5 w-fit!',
        variant === 'outline' && 'shadow-xs',
        className,
      )}
      {...props}
    >
      <ToggleGroupProvider value={{ variant, size }}>
        {props.type === 'single' ? (
          <ToggleGroupHighlightPrimitive className={cn('bg-accent rounded-md', highlightClassName)}>
            {children}
          </ToggleGroupHighlightPrimitive>
        ) : (
          children
        )}
      </ToggleGroupProvider>
    </ToggleGroupPrimitive>
  );
}

type ToggleGroupItemProps = ToggleGroupItemPrimitiveProps & VariantProps<typeof toggleVariants>;

function ToggleGroupItem({ className, children, variant, size, ...props }: ToggleGroupItemProps) {
  const { variant: contextVariant, size: contextSize } = useToggleGroup();
  const { type } = useToggleGroupPrimitive();

  return (
    <ToggleGroupHighlightItemPrimitive
      value={props.value}
      className={cn(type === 'multiple' && 'bg-accent rounded-md')}
    >
      <ToggleGroupItemPrimitive
        data-variant={contextVariant || variant}
        data-size={contextSize || size}
        className={cn(
          toggleVariants({
            variant: contextVariant || variant,
            size: contextSize || size,
          }),
          'cursor-pointer min-w-0 border-0 flex-1 shrink-0 shadow-none rounded-md focus:z-10 focus-visible:z-10 not-focus:text-sf-muted',
          className,
        )}
        {...props}
      >
        {children}
      </ToggleGroupItemPrimitive>
    </ToggleGroupHighlightItemPrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem, type ToggleGroupProps, type ToggleGroupItemProps };
