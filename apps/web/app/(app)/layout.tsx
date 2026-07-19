import type { ReactNode } from 'react';
import { PasswordReminder } from '@/components/auth/password-reminder';
import { AppHeader } from '@/components/layout/app-header';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { ProtectedLayout } from '@/components/layout/protected-layout';

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedLayout>
      <div className="flex min-h-screen bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <AppHeader />
          <PasswordReminder />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </ProtectedLayout>
  );
}
