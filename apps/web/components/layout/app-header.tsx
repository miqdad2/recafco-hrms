'use client';

import * as React from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { ChangePasswordModal } from '@/components/auth/change-password-modal';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';

export function AppHeader() {
  const { user, logout } = useAuth();
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-6">
      <div />
      <div className="flex items-center gap-4">
        {user ? (
          <div className="text-right leading-tight">
            <p className="text-sm font-medium text-foreground">{user.username}</p>
            <p className="text-xs text-muted-foreground">{user.roles.join(', ')}</p>
          </div>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => setChangePasswordOpen(true)}>
          <KeyRound className="h-4 w-4" />
          Change Password
        </Button>
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </header>
  );
}
