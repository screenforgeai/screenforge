import { createContext, useContext, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'framer-motion';
import { Button } from 'src/lib/ui';
import { cn } from 'src/lib/utils';

/** Quick and settled: the hover background glides, it doesn't bounce around. */
const PILL_SPRING = { type: 'spring', visualDuration: 0.26, bounce: 0.12 } as const;
const PILL_FADE = { duration: 0.14, ease: [0.32, 0.72, 0, 1] } as const;

type GroupState = {
  hovered: string | null;
  setHovered: (id: string | null) => void;
};

const GroupContext = createContext<GroupState | null>(null);

type GroupProps = ComponentProps<'div'> & {
  /** Scopes the sliding backgrounds, so two groups never trade theirs. */
  id: string;
  children: ReactNode;
};

/**
 * A row of top-bar buttons that share one hover background, which slides from
 * button to button as the pointer moves along the row and fades out when it
 * leaves. Reduced motion makes it jump instead of slide.
 */
export const TopBarGroup = ({ id, children, onMouseLeave, ...props }: GroupProps) => {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <GroupContext.Provider value={{ hovered, setHovered }}>
      <MotionConfig reducedMotion="user">
        <LayoutGroup id={id}>
          <div
            role="group"
            {...props}
            onMouseLeave={(event) => {
              setHovered(null);
              onMouseLeave?.(event);
            }}
          >
            {children}
          </div>
        </LayoutGroup>
      </MotionConfig>
    </GroupContext.Provider>
  );
};

type ButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'active'> & {
  itemId: string;
  /** Selected buttons (the active tool) get their own background, which also slides. */
  selected?: boolean;
};

export const TopBarButton = ({
  itemId,
  selected = false,
  disabled,
  className,
  children,
  onMouseEnter,
  ...props
}: ButtonProps) => {
  const group = useContext(GroupContext);
  const hovered = !disabled && group?.hovered === itemId;
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      className={cn(
        'relative rounded-md hover:bg-transparent',
        selected && 'text-sf-primary',
        className,
      )}
      onMouseEnter={(event) => {
        if (!disabled) {
          group?.setHovered(itemId);
        }
        onMouseEnter?.(event);
      }}
      {...props}
    >
      <AnimatePresence initial={false}>
        {hovered && (
          <motion.span
            key="hover"
            data-pill="hover"
            layoutId="hover"
            aria-hidden
            className="absolute inset-0 rounded-md bg-secondary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: PILL_FADE }}
            exit={{ opacity: 0, transition: PILL_FADE }}
            transition={PILL_SPRING}
          />
        )}
      </AnimatePresence>
      {selected && (
        <motion.span
          data-pill="selected"
          layoutId="selected"
          aria-hidden
          className="absolute inset-0 rounded-md bg-sf-border"
          transition={PILL_SPRING}
        />
      )}
      <span className="relative z-10 flex">{children}</span>
    </Button>
  );
};
