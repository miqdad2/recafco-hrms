'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from './form-field';
import { Spinner } from './spinner';

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  isLoading?: boolean;
  error?: string | undefined;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * Note: this component holds local `reason` input state that must reset between invocations
 * (e.g. blocking device A, cancelling, then blocking device B shouldn't show A's leftover text).
 * Rather than syncing that reset through a `useEffect` keyed on `open` (which the current
 * lint rules flag as a state-in-effect anti-pattern), the caller should mount a fresh instance
 * per target — e.g. `<ReasonDialog key={target?.id ?? 'closed'} ... />` — so React's own
 * remount-on-key-change resets the state naturally.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  isLoading,
  error,
  onConfirm,
  onCancel,
}: ReasonDialogProps) {
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  const trimmed = reason.trim();
  const validationError = touched && trimmed.length === 0 ? 'A reason is required.' : undefined;

  function handleConfirm() {
    setTouched(true);
    if (trimmed.length === 0) {
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4">
          <FormField label="Reason" htmlFor="reason-dialog-input" required error={validationError ?? error}>
            <Textarea
              id="reason-dialog-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
            />
          </FormField>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading} className="bg-error hover:bg-error/90">
            {isLoading ? (
              <>
                <Spinner /> Please wait…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
