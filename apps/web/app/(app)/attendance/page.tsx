'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { ErrorAlert } from '@/components/admin/error-alert';
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import {
  listMyAttendancePunches,
  type AttendanceRawPunch,
  type PunchValidationStatus,
} from '@/lib/api/attendance-punches';
import { listMyAttendanceSummaries, type AttendanceDailySummary, type DailyAttendanceStatus } from '@/lib/api/attendance-summaries';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '@/lib/auth/no-employee-message';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// Matches the labels/tones already used on the admin Attendance Summaries screen.
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

const PUNCH_STATUS_LABELS: Record<PunchValidationStatus, string> = {
  ACCEPTED: 'Accepted',
  ACCEPTED_WITH_WARNING: 'Accepted (Warning)',
  REJECTED_OUTSIDE_LOCATION: 'Rejected: Outside Location',
  REJECTED_FAKE_GPS: 'Rejected: Location Issue',
  REJECTED_UNREGISTERED_DEVICE: 'Rejected: Device Not Approved',
  REJECTED_EMPLOYEE_INACTIVE: 'Rejected: Inactive',
  REJECTED_DUPLICATE: 'Duplicate',
  PENDING_HR_REVIEW: 'Pending Review',
  PENDING_MANAGER_APPROVAL: 'Pending Approval',
  REJECTED_POLICY_VIOLATION: 'Rejected: Policy',
};

const PUNCH_STATUS_TONES: Record<PunchValidationStatus, BadgeTone> = {
  ACCEPTED: 'success',
  ACCEPTED_WITH_WARNING: 'warning',
  REJECTED_OUTSIDE_LOCATION: 'error',
  REJECTED_FAKE_GPS: 'error',
  REJECTED_UNREGISTERED_DEVICE: 'error',
  REJECTED_EMPLOYEE_INACTIVE: 'error',
  REJECTED_DUPLICATE: 'muted',
  PENDING_HR_REVIEW: 'warning',
  PENDING_MANAGER_APPROVAL: 'warning',
  REJECTED_POLICY_VIOLATION: 'error',
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

export default function AttendancePage() {
  const { user } = useAuth();
  const hasEmployee = user?.employeeId != null;

  const summariesQuery = useQuery({
    queryKey: ['my-attendance-summaries'],
    queryFn: () => listMyAttendanceSummaries({ limit: 15 }),
    enabled: hasEmployee,
  });

  const punchesQuery = useQuery({
    queryKey: ['my-attendance-punches'],
    queryFn: () => listMyAttendancePunches({ limit: 15 }),
    enabled: hasEmployee,
  });

  if (!hasEmployee) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My Attendance</h1>
        </div>
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {NO_EMPLOYEE_MESSAGE}
        </div>
      </div>
    );
  }

  const summaryColumns: DataTableColumn<AttendanceDailySummary>[] = [
    { key: 'workDate', header: 'Date', render: (row) => formatDate(row.workDate) },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge label={SUMMARY_STATUS_LABELS[row.status]} tone={SUMMARY_STATUS_TONES[row.status]} />,
    },
    { key: 'officialInTime', header: 'In', render: (row) => formatDateTime(row.officialInTime) },
    { key: 'officialOutTime', header: 'Out', render: (row) => formatDateTime(row.officialOutTime) },
    { key: 'totalWorkedMinutes', header: 'Worked (min)', render: (row) => row.totalWorkedMinutes },
    { key: 'lateMinutes', header: 'Late (min)', render: (row) => row.lateMinutes },
  ];

  const punchColumns: DataTableColumn<AttendanceRawPunch>[] = [
    { key: 'punchType', header: 'Type', render: (row) => row.punchType },
    { key: 'punchTimeSource', header: 'Time', render: (row) => formatDateTime(row.punchTimeSource) },
    { key: 'sourceType', header: 'Source', render: (row) => row.sourceType },
    {
      key: 'validationStatus',
      header: 'Status',
      render: (row) => (
        <StatusBadge label={PUNCH_STATUS_LABELS[row.validationStatus]} tone={PUNCH_STATUS_TONES[row.validationStatus]} />
      ),
    },
    { key: 'isOfficial', header: 'Official', render: (row) => (row.isOfficial ? 'Yes' : 'No') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">My Attendance</h1>
        <p className="text-sm text-muted-foreground">Your own recent punches and daily summaries.</p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-foreground">Recent Summaries</h2>
        {summariesQuery.isError ? (
          <ErrorAlert message={errorMessage(summariesQuery.error, 'Failed to load summaries.')} />
        ) : (
          <DataTable
            columns={summaryColumns}
            data={summariesQuery.data?.data ?? []}
            getRowId={(row) => row.id}
            isLoading={summariesQuery.isLoading}
            emptyMessage="No attendance summaries yet."
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-foreground">Recent Punches</h2>
        {punchesQuery.isError ? (
          <ErrorAlert message={errorMessage(punchesQuery.error, 'Failed to load punches.')} />
        ) : (
          <DataTable
            columns={punchColumns}
            data={punchesQuery.data?.data ?? []}
            getRowId={(row) => row.id}
            isLoading={punchesQuery.isLoading}
            emptyMessage="No punches recorded yet."
          />
        )}
      </div>
    </div>
  );
}
