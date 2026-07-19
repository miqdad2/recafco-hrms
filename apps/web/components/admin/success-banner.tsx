'use client';

import * as React from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface SuccessBannerProps {
  message: string;
  onDismiss: () => void;
}

export function SuccessBanner({ message, onDismiss }: SuccessBannerProps) {
  React.useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
      <span className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-success/70 transition-colors hover:text-success"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
