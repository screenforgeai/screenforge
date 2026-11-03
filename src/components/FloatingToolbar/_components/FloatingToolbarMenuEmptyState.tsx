import type { ReactNode } from 'react';

interface FloatingToolbarMenuEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
}

export const FloatingToolbarMenuEmptyState = ({
  icon,
  title,
  description,
}: FloatingToolbarMenuEmptyStateProps) => {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-lg bg-[#131318] px-4 py-4 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/8 bg-[#1a1a20] text-sf-secondary">
        {icon}
      </div>
      <p className="text-sm font-medium text-sf-primary">{title}</p>
      <p className="mt-1 max-w-[22ch] text-xs text-sf-muted">{description}</p>
    </div>
  );
};
