import * as React from 'react';

import { cn } from '../../../utils';

interface Props {
  helperText?: React.ReactNode;
  label?: string;
  error?: boolean;
  errorText?: string;
  prefixIcon?: React.ReactNode;
  onPrefixIconClick?: () => void;
  suffixIcon?: React.ReactNode;
  onSuffixIconClick?: () => void;
  disabled?: boolean;
  filled?: boolean;
  labelProps?: {
    className?: string;
  };
}

function Input({
  className,
  type,
  helperText,
  label,
  error,
  errorText,
  prefixIcon,
  onPrefixIconClick,
  suffixIcon,
  onSuffixIconClick,
  disabled,
  filled,
  labelProps,
  ...props
}: React.ComponentProps<'input'> & Props) {
  return (
    <div>
      {label && (
        <label
          htmlFor={props.id}
          className={cn(
            'block text-md font-medium mb-1 input-label text-sf-secondary',
            labelProps?.className,
          )}
        >
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type={type}
          data-slot="input"
          aria-invalid={error}
          disabled={disabled}
          className={cn(
            'placeholder:text-sf-muted file:text-foreground selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 rounded-md border border-sf-border py-1 text-md font-medium tracking-[-0.01em] text-sf-primary outline-none transition-[border-color,box-shadow] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            filled ? 'bg-sf-panel' : 'bg-sf-bg',
            'focus:border-sf-border-lt',
            prefixIcon && suffixIcon
              ? 'pl-10 pr-10'
              : prefixIcon
                ? 'pl-10 pr-3'
                : suffixIcon
                  ? 'pr-10 pl-3'
                  : 'px-3',
            error && 'border-destructive',
            className,
          )}
          {...props}
        />

        {prefixIcon && (
          <div
            className={cn(
              'absolute left-3 top-1/2 -translate-y-1/2',
              onPrefixIconClick ? 'cursor-pointer' : 'pointer-events-none',
            )}
            onClick={onPrefixIconClick}
          >
            {prefixIcon}
          </div>
        )}

        {suffixIcon && (
          <div
            className={cn(
              'absolute right-3 top-1/2 -translate-y-1/2',
              onSuffixIconClick ? 'cursor-pointer' : 'pointer-events-none',
            )}
            onClick={onSuffixIconClick}
          >
            {suffixIcon}
          </div>
        )}
      </div>

      {errorText && error && (
        <p className="mt-1 ml-1 text-sm text-destructive error-text">{errorText}</p>
      )}

      {helperText && !error && (
        <p className="mt-1 ml-1 text-sm text-gray-600 helper-text">{helperText}</p>
      )}
    </div>
  );
}

export { Input };
