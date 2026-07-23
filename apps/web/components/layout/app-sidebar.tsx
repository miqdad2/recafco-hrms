'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission, isAdminUser } from '@/lib/auth/permissions';
import { EMPLOYEE_NAV_ITEMS, NAV_ITEMS, type EmployeeNavEntry } from '@/lib/routes';
import { cn } from '@/lib/utils';

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function EmployeeNav({ entries, pathname }: { entries: EmployeeNavEntry[]; pathname: string }) {
  return (
    <>
      {entries.map((entry) => {
        if (entry.type === 'link') {
          const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
          return <NavLink key={entry.href} href={entry.href} label={entry.label} icon={entry.icon} active={active} />;
        }

        const GroupIcon = entry.icon;
        return (
          <div key={entry.label} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">
              <GroupIcon className="h-4 w-4" />
              {entry.label}
            </div>
            <div className="flex flex-col gap-1 pl-4">
              {entry.children.map((child) => {
                if (child.type === 'coming-soon') {
                  return (
                    <div
                      key={child.label}
                      className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-subtle-foreground"
                    >
                      <span>{child.label}</span>
                      <span className="text-xs">Coming soon</span>
                    </div>
                  );
                }
                const active = pathname === child.href || pathname.startsWith(`${child.href}/`);
                return <NavLink key={child.href} href={child.href} label={child.label} icon={child.icon} active={active} />;
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  // Same admin-vs-employee split the Dashboard uses — a plain EMPLOYEE-role user (no
  // employees.read/departments.read/etc.) gets the grouped self-service nav instead of an
  // admin sidebar filtered down to nothing but "Dashboard".
  const isAdmin = isAdminUser(user);
  const visibleAdminItems = isAdmin
    ? NAV_ITEMS.filter((item) => !item.permission || hasPermission(user, item.permission))
    : [];

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-16 items-center border-b border-border px-6">
        <span className="text-lg font-semibold text-foreground">RECAFCO HRMS</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {isAdmin ? (
          visibleAdminItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={active} />;
          })
        ) : (
          <EmployeeNav entries={EMPLOYEE_NAV_ITEMS} pathname={pathname} />
        )}
      </nav>
    </aside>
  );
}
