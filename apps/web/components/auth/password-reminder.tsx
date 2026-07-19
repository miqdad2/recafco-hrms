'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import { ChangePasswordModal } from './change-password-modal';

const LATER_DELAY_MS = 2 * 60 * 1000;

export function PasswordReminder() {
  const { user } = useAuth();
  const [dismissedAt, setDismissedAt] = React.useState<number | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  React.useEffect(() => {
    if (dismissedAt === null) {
      return;
    }
    const timer = setTimeout(() => setDismissedAt(null), LATER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dismissedAt]);

  if (!user?.mustChangePassword || dismissedAt !== null) {
    return null;
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 border-b border-warning/30 bg-warning/10 px-6 py-3 text-sm text-warning">
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          You are using a temporary password. Please change it for security.
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setModalOpen(true)}>
            Change Password
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDismissedAt(Date.now())}>
            Later
          </Button>
        </div>
      </div>
      <ChangePasswordModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
