import { AlertTriangle } from 'lucide-react';

interface ErrorAlertProps {
  message: string;
}

export function ErrorAlert({ message }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
