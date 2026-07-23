'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, KeyRound, LogOut, User } from 'lucide-react';
import { ChangePasswordModal } from '@/components/auth/change-password-modal';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * Employee-only header dropdown (see app-header.tsx — admin keeps its existing two-button
 * header untouched). A plain local-state dropdown, not a new Radix/headless-UI dependency:
 * no such primitive exists in this codebase yet, and a single simple menu doesn't justify
 * adding one, matching this project's established "don't add a library for something a plain
 * component can do" precedent (mobile Units 15/17/19/19.4).
 */
export function ProfileDropdown() {
  const { user, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);

  if (!user) {
    return null;
  }

  const roleLabel = user.roles.join(', ') || '—';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-muted"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
          {user.username.slice(0, 2).toUpperCase()}
        </div>
        <div className="text-left leading-tight">
          <p className="font-medium text-foreground">{user.username}</p>
          <p className="text-xs text-muted-foreground">{roleLabel}</p>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-border bg-surface py-1 shadow-lg">
            <div className="border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">{user.username}</p>
              <p className="text-xs text-muted-foreground">Role: {roleLabel}</p>
            </div>
            <Link
              href="/profile"
              className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-surface-muted"
              onClick={() => setOpen(false)}
            >
              <User className="h-4 w-4" />
              User Profile
            </Link>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
              onClick={() => {
                setOpen(false);
                setChangePasswordOpen(true);
              }}
            >
              <KeyRound className="h-4 w-4" />
              Change Password
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-surface-muted"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </>
      ) : null}

      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </div>
  );
}
