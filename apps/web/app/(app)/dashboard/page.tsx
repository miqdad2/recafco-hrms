'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CalendarCheck,
  Clock,
  FileEdit,
  KeyRound,
  Smartphone,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { ChangePasswordModal } from '@/components/auth/change-password-modal';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { ErrorAlert } from '@/components/admin/error-alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import {
  listMyAttendanceCorrections,
  type AttendanceCorrection,
  type CorrectionStatus,
  type CorrectionType,
} from '@/lib/api/attendance-corrections';
import { listMyAttendanceSummaries, type AttendanceDailySummary, type DailyAttendanceStatus } from '@/lib/api/attendance-summaries';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '@/lib/auth/no-employee-message';
import { isAdminUser } from '@/lib/auth/permissions';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

const ADMIN_DASHBOARD_CARDS = [
  { title: 'Employees', description: 'Headcount, onboarding, and directory management.', icon: Users },
  { title: 'Attendance Today', description: 'Live present/absent/late counts across all sites.', icon: CalendarCheck },
  {
    title: 'Pending Corrections',
    description: 'Missed-punch and correction requests awaiting approval.',
    icon: FileEdit,
  },
  { title: 'Device Status', description: 'Health of registered biometric and mobile devices.', icon: Building2 },
];

// Matches the labels/tones already used on the admin + employee Corrections/Attendance screens.
const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
const CORRECTION_STATUS_TONES: Record<CorrectionStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  CANCELLED: 'muted',
};
const CORRECTION_TYPE_LABELS: Record<CorrectionType, string> = {
  MISSED_IN: 'Missed IN',
  MISSED_OUT: 'Missed OUT',
  WRONG_IN: 'Wrong IN',
  WRONG_OUT: 'Wrong OUT',
  MANUAL_ADJUSTMENT: 'Manual Adjustment',
  OTHER: 'Other',
};
const SUMMARY_STATUS_LABELS: Record<DailyAttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  HALF_DAY: 'Half Day',
  LEAVE: 'Leave',
  WEEK_OFF: 'Week Off',
  HOLIDAY: 'Holiday',
  MISSING_PUNCH: 'Missing Punch',
};
const SUMMARY_STATUS_TONES: Record<DailyAttendanceStatus, BadgeTone> = {
  PRESENT: 'success',
  ABSENT: 'error',
  LATE: 'warning',
  HALF_DAY: 'warning',
  LEAVE: 'info',
  WEEK_OFF: 'muted',
  HOLIDAY: 'muted',
  MISSING_PUNCH: 'warning',
};

interface QuickLink {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  action?: 'change-password';
}

const QUICK_LINKS: QuickLink[] = [
  { key: 'attendance', label: 'My Attendance', icon: Clock, href: '/attendance' },
  { key: 'correction', label: 'Correction Request', icon: FileEdit, href: '/corrections' },
  { key: 'device', label: 'Device Registration', icon: Smartphone, href: '/device' },
  { key: 'change-password', label: 'Change Password', icon: KeyRound, action: 'change-password' },
];

function AdminDashboard() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {ADMIN_DASHBOARD_CARDS.map((card) => (
        <Card key={card.title}>
          <CardHeader>
            <card.icon className="h-5 w-5 text-accent" />
            <CardTitle>{card.title}</CardTitle>
            <CardDescription>{card.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="text-sm font-medium text-subtle-foreground">Coming soon</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmployeeDashboard({ hasEmployee }: { hasEmployee: boolean }) {
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);

  const correctionsQuery = useQuery({
    queryKey: ['dashboard-my-corrections'],
    queryFn: () => listMyAttendanceCorrections({ limit: 5 }),
    enabled: hasEmployee,
  });

  const summariesQuery = useQuery({
    queryKey: ['dashboard-my-summaries'],
    queryFn: () => listMyAttendanceSummaries({ limit: 7 }),
    enabled: hasEmployee,
  });

  if (!hasEmployee) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
        {NO_EMPLOYEE_MESSAGE}
      </div>
    );
  }

  const correctionColumns: DataTableColumn<AttendanceCorrection>[] = [
    { key: 'workDate', header: 'Date', render: (row) => formatDate(row.workDate) },
    { key: 'correctionType', header: 'Type', render: (row) => CORRECTION_TYPE_LABELS[row.correctionType] },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge label={CORRECTION_STATUS_LABELS[row.status]} tone={CORRECTION_STATUS_TONES[row.status]} />
      ),
    },
    { key: 'reason', header: 'Reason', render: (row) => <span className="line-clamp-2">{row.reason}</span> },
  ];

  const summaryColumns: DataTableColumn<AttendanceDailySummary>[] = [
    { key: 'workDate', header: 'Date', render: (row) => formatDate(row.workDate) },
    { key: 'officialInTime', header: 'Check In', render: (row) => formatDateTime(row.officialInTime) },
    { key: 'officialOutTime', header: 'Check Out', render: (row) => formatDateTime(row.officialOutTime) },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge label={SUMMARY_STATUS_LABELS[row.status]} tone={SUMMARY_STATUS_TONES[row.status]} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* B. Quick links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {QUICK_LINKS.map((link) => {
          const content = (
            <>
              <link.icon className="h-5 w-5 text-accent" />
              <span className="text-sm font-medium text-foreground">{link.label}</span>
            </>
          );
          return link.action === 'change-password' ? (
            <button
              key={link.key}
              type="button"
              onClick={() => setChangePasswordOpen(true)}
              className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-muted"
            >
              {content}
            </button>
          ) : (
            <Link
              key={link.key}
              href={link.href as string}
              className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-muted"
            >
              {content}
            </Link>
          );
        })}
      </div>

      {/* C. Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Annual Leave Balance</CardDescription>
            <CardTitle className="text-subtle-foreground">Coming soon</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Sick Leave Balance</CardDescription>
            <CardTitle className="text-subtle-foreground">Coming soon</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Work Location</CardDescription>
            <CardTitle className="text-subtle-foreground">—</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Current Department</CardDescription>
            <CardTitle className="text-subtle-foreground">—</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* D. My Requests */}
      <Card>
        <CardHeader>
          <CardTitle>My Requests</CardTitle>
          <CardDescription>Your latest attendance correction requests.</CardDescription>
        </CardHeader>
        <CardContent>
          {correctionsQuery.isError ? (
            <ErrorAlert message={errorMessage(correctionsQuery.error, 'Failed to load requests.')} />
          ) : (
            <DataTable
              columns={correctionColumns}
              data={correctionsQuery.data?.data ?? []}
              getRowId={(row) => row.id}
              isLoading={correctionsQuery.isLoading}
              emptyMessage="No requests to display."
            />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* E. Announcements */}
        <Card>
          <CardHeader>
            <CardTitle>Announcements</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No announcements available at the moment.</p>
          </CardContent>
        </Card>

        {/* F. My Documents */}
        <Card>
          <CardHeader>
            <CardTitle>My Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Documents module coming soon.</p>
          </CardContent>
        </Card>
      </div>

      {/* G. Attendance Last 7 Days */}
      <Card>
        <CardHeader>
          <CardTitle>Attendance Last 7 Days</CardTitle>
        </CardHeader>
        <CardContent>
          {summariesQuery.isError ? (
            <ErrorAlert message={errorMessage(summariesQuery.error, 'Failed to load attendance.')} />
          ) : (
            <DataTable
              columns={summaryColumns}
              data={summariesQuery.data?.data ?? []}
              getRowId={(row) => row.id}
              isLoading={summariesQuery.isLoading}
              emptyMessage="No attendance summary calculated yet."
            />
          )}
        </CardContent>
      </Card>

      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const admin = isAdminUser(user);
  const hasEmployee = user?.employeeId != null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {admin ? 'Dashboard' : `Hello, ${user?.username ?? ''}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {admin
            ? `Welcome back${user ? `, ${user.username}` : ''}.`
            : hasEmployee
              ? `Employee ID: ${user?.employeeId} · ${user?.roles.join(', ') || 'No roles assigned'}`
              : user?.roles.join(', ') || 'No roles assigned'}
        </p>
      </div>
      {admin ? <AdminDashboard /> : <EmployeeDashboard hasEmployee={hasEmployee} />}
    </div>
  );
}
