import { useAnimation, motion } from 'motion/react';
import { Switch, SwitchThumb } from 'src/lib/ui';
import { WIDGET_PANEL_HEADER_CLASS } from 'src/components/layout';
import { cn } from 'src/lib/utils';

interface WidgetEnabledGateProps {
  title: string;
  icon?: React.ReactNode;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export const WidgetEnabledGate = ({
  title,
  icon,
  enabled,
  onToggle,
  children,
  className,
}: WidgetEnabledGateProps) => {
  const controls = useAnimation();

  const handleOverlayClick = () => {
    controls.start({
      boxShadow: [
        '0 0 0 0px rgba(212,69,35,0)',
        '0 0 0 3px rgba(212,69,35,0.45)',
        '0 0 0 0px rgba(212,69,35,0)',
      ],
      transition: { duration: 0.45, times: [0, 0.28, 1], ease: 'easeOut' },
    });
  };

  return (
    <>
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        {icon}
        <span className="flex-1">{title}</span>
        <motion.div animate={controls} className="inline-flex rounded-full">
          <Switch
            size="xs"
            checked={enabled}
            onCheckedChange={onToggle}
            aria-label={`${title} ${enabled ? 'on' : 'off'}`}
          >
            <SwitchThumb />
          </Switch>
        </motion.div>
      </div>

      <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col transition-opacity duration-200',
            !enabled && 'opacity-70',
          )}
        >
          {children}
        </div>
        {!enabled && (
          <div className="absolute inset-0 cursor-default" onClick={handleOverlayClick} />
        )}
      </div>
    </>
  );
};
