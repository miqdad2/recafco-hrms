import { Inbox, type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  message: string;
  icon?: LucideIcon;
}

export function EmptyState({ message, icon: Icon = Inbox }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <Icon className="h-8 w-8 text-subtle-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
