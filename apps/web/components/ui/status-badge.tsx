import { cn } from '@/lib/utils';

export type BadgeTone = 'success' | 'warning' | 'error' | 'info' | 'muted' | 'locked';

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-error/10 text-error',
  info: 'bg-info/10 text-info',
  muted: 'bg-surface-muted text-muted-foreground',
  locked: 'bg-locked/10 text-locked',
};

interface StatusBadgeProps {
  label: string;
  tone: BadgeTone;
  className?: string;
}

export function StatusBadge({ label, tone, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
