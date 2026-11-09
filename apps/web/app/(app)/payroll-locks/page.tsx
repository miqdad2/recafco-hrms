'use client';

import * as React from 'react';
import Link from 'next/link';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AccessDenied } from '@/components/admin/access-denied';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { DetailRow } from '@/components/admin/detail-row';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { PaginationControls } from '@/components/admin/pagination-controls';
import { ReasonDialog } from '@/components/admin/reason-dialog';
import { Spinner } from '@/components/admin/spinner';
import { SuccessBanner } from '@/components/admin/success-banner';
import { LockReadinessDialog } from '@/components/payroll/lock-readiness-dialog';
import { MonthPicker } from '@/components/payroll/payroll-ui';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import {
  PAYROLL_LOCK_STATUSES,
  createPayrollLock,
  listPayrollLocks,
  unlockPayrollPeriod,
  type PayrollLock,
  type PayrollLockStatus,
} from '@/lib/api/payroll-locks';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';
import {
  NOT_CALCULATED,
  currentKuwaitMonth,
  formatKuwaitDateTime,
  formatMonth,
  formatWorkDate,
  shiftMonth,
} from '@/lib/payroll-attendance/display';
import { describeApiError } from '@/lib/payroll-attendance/errors';

const LOCK_STATUS_LABELS: Record<PayrollLockStatus, string> = { OPEN: 'Open', LOCKED: 'Locked', REOPENED: 'Reopened' };
const LOCK_STATUS_TONES: Record<PayrollLockStatus, BadgeTone> = { OPEN: 'info', LOCKED: 'locked', REOPENED: 'warning' };

function dayCount(lock: PayrollLock): number {
  return Math.round((Date.parse(lock.periodEnd.slice(0, 10)) - Date.parse(lock.periodStart.slice(0, 10))) / 86_400_000) + 1;
}

function periodLabel(lock: PayrollLock): string {
  return `${formatWorkDate(lock.periodStart)} – ${formatWorkDate(lock.periodEnd)}`;
}

function lastDayOfMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
}

const createSchema = z
  .object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date is required'),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date is required'),
    reason: z.string().max(500).optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((values) => values.periodStart <= values.periodEnd, {
    message: 'End date must be on or after the start date',
    path: ['periodEnd'],
  });
type CreateFormValues = z.infer<typeof createSchema>;

export default function PayrollLocksPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'payrollLocks.read');
  const canCreate = hasPermission(user, 'payrollLocks.create');
  const canLock = hasPermission(user, 'payrollLocks.lock');
  const canUnlock = hasPermission(user, 'payrollLocks.unlock');
  const canReadAttendance = hasPermission(user, 'payrollAttendance.read');
  const canReadAudit = hasPermission(user, 'audit.read');

  const [page, setPage] = React.useState(1);
  const [statusFilter, setStatusFilter] = React.useState<PayrollLockStatus | ''>('');
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [viewLock, setViewLock] = React.useState<PayrollLock | null>(null);
  const [lockTarget, setLockTarget] = React.useState<PayrollLock | null>(null);
  const [unlockTarget, setUnlockTarget] = React.useState<PayrollLock | null>(null);

  const listQuery = useQuery({
    queryKey: ['payroll-locks', { page, statusFilter }],
    queryFn: ({ signal }) => listPayrollLocks({ page, limit: 20, status: statusFilter || undefined }, signal),
    enabled: canRead,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['payroll-locks'] });
    void queryClient.invalidateQueries({ queryKey: ['payroll-attendance'] });
  };

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { periodStart: '', periodEnd: '', reason: '', notes: '' },
  });
  const [createMonth, setCreateMonth] = React.useState(() => shiftMonth(currentKuwaitMonth(), -1));
  const createMutation = useMutation({
    mutationFn: (values: CreateFormValues) =>
      createPayrollLock({
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        reason: values.reason?.trim() || undefined,
        notes: values.notes?.trim() || undefined,
      }),
    retry: false,
    onSuccess: (lock) => {
      invalidateAll();
      setSuccessMessage(`Payroll period ${periodLabel(lock)} created. It is Open — nothing is locked yet.`);
      setCreateOpen(false);
      createForm.reset();
    },
  });

  const unlockMutation = useMutation({
    mutationFn: ({ lock, reason }: { lock: PayrollLock; reason: string }) => unlockPayrollPeriod(lock.id, reason),
    retry: false,
    onSuccess: (result) => {
      invalidateAll();
      setSuccessMessage(
        `Period ${periodLabel(result.lock)} reopened. ${result.affectedSummaryCount} daily attendance record(s) were unlocked.`,
      );
      setUnlockTarget(null);
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  function openLockDialog(lock: PayrollLock) {
    setLockTarget(lock);
  }

  const columns: DataTableColumn<PayrollLock>[] = [
    {
      key: 'period',
      header: 'Period',
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-foreground">{periodLabel(row)}</span>
          <span className="text-xs text-muted-foreground">{dayCount(row)} day(s)</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge label={LOCK_STATUS_LABELS[row.status]} tone={LOCK_STATUS_TONES[row.status]} className="text-sm" />
      ),
    },
    {
      key: 'locked',
      header: 'Last locked',
      render: (row) =>
        row.lockedAt ? (
          <span className="flex flex-col">
            <span>{formatKuwaitDateTime(row.lockedAt)}</span>
            <span className="text-xs text-muted-foreground">{row.summaryCount ?? 0} daily record(s)</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      key: 'reopened',
      header: 'Last reopened',
      render: (row) =>
        row.reopenedAt ? (
          <span className="flex max-w-[16rem] flex-col">
            <span>{formatKuwaitDateTime(row.reopenedAt)}</span>
            <span className="truncate text-xs text-muted-foreground" title={row.reopenReason ?? ''}>
              Reason: {row.reopenReason ?? NOT_CALCULATED}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-2">
          {canReadAttendance ? (
            <Link
              href={`/payroll-attendance?month=${row.periodStart.slice(0, 7)}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Attendance
            </Link>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setViewLock(row)}>
            Details
          </Button>
          {canLock && (row.status === 'OPEN' || row.status === 'REOPENED') ? (
            <Button size="sm" onClick={() => openLockDialog(row)}>
              <Lock className="h-4 w-4" /> Lock
            </Button>
          ) : null}
          {canUnlock && row.status === 'LOCKED' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                unlockMutation.reset();
                setUnlockTarget(row);
              }}
            >
              <LockOpen className="h-4 w-4" /> Unlock
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const listError = listQuery.isError ? describeApiError(listQuery.error, 'Could not load payroll periods.') : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Monthly Closing</h1>
          <p className="text-base text-muted-foreground">
            Create and lock payroll periods. Locking freezes attendance for those dates; it does not approve payroll or
            calculate salary.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="lg" onClick={() => void listQuery.refetch()} disabled={listQuery.isFetching}>
            {listQuery.isFetching ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
          {canCreate ? (
            <Button
              size="lg"
              onClick={() => {
                createMutation.reset();
                createForm.reset({
                  periodStart: `${createMonth}-01`,
                  periodEnd: lastDayOfMonth(createMonth),
                  reason: '',
                  notes: '',
                });
                setCreateOpen(true);
              }}
            >
              <CalendarPlus className="h-4 w-4" /> Create period
            </Button>
          ) : null}
        </div>
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {listError ? <ErrorAlert message={listError} /> : null}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-muted-foreground">Status</span>
          <Select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as PayrollLockStatus | '');
              setPage(1);
            }}
            className="w-48"
          >
            <option value="">All statuses</option>
            {PAYROLL_LOCK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {LOCK_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </label>
        <p className="max-w-xl text-sm text-muted-foreground">
          <strong>Open</strong> — created, not locked. <strong>Locked</strong> — attendance frozen.{' '}
          <strong>Reopened</strong> — unlocked with a reason; can be locked again.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={listQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        isLoading={listQuery.isLoading}
        emptyMessage="No payroll periods have been created yet."
      />
      {listQuery.data && listQuery.data.meta.total > 0 ? (
        <PaginationControls
          page={listQuery.data.meta.page}
          totalPages={Math.max(listQuery.data.meta.totalPages, 1)}
          total={listQuery.data.meta.total}
          onPageChange={setPage}
        />
      ) : null}

      {/* ---- Create period ---- */}
      <FormModal open={createOpen} title="Create payroll period" onClose={() => setCreateOpen(false)}>
        <form
          onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2 rounded-md bg-surface-muted p-3">
            <span className="text-sm font-medium text-foreground">Quick fill: whole month</span>
            <div className="flex flex-wrap items-center gap-2">
              <MonthPicker id="create-month" value={createMonth} onChange={setCreateMonth} />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  createForm.setValue('periodStart', `${createMonth}-01`, { shouldValidate: true });
                  createForm.setValue('periodEnd', lastDayOfMonth(createMonth), { shouldValidate: true });
                }}
              >
                Use {formatMonth(createMonth)}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Start date" htmlFor="lock-start" required error={createForm.formState.errors.periodStart?.message}>
              <Input id="lock-start" type="date" {...createForm.register('periodStart')} />
            </FormField>
            <FormField label="End date" htmlFor="lock-end" required error={createForm.formState.errors.periodEnd?.message}>
              <Input id="lock-end" type="date" {...createForm.register('periodEnd')} />
            </FormField>
          </div>
          <FormField label="Reason (optional)" htmlFor="lock-reason" error={createForm.formState.errors.reason?.message}>
            <Input id="lock-reason" maxLength={500} {...createForm.register('reason')} />
          </FormField>
          <FormField label="Notes (optional)" htmlFor="lock-notes" error={createForm.formState.errors.notes?.message}>
            <Textarea id="lock-notes" rows={3} maxLength={1000} {...createForm.register('notes')} />
          </FormField>
          <p className="text-sm text-muted-foreground">
            Creating a period does not lock anything. Periods cannot overlap another Open or Locked period.
          </p>
          {createMutation.isError ? (
            <ErrorAlert message={describeApiError(createMutation.error, 'Could not create the period.') ?? ''} />
          ) : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Spinner /> Creating…
                </>
              ) : (
                'Create period'
              )}
            </Button>
          </div>
        </form>
      </FormModal>

      {/* ---- Lock confirmation (Unit 21.1: backend readiness) ---- */}
      <LockReadinessDialog
        key={lockTarget?.id ?? 'closed'}
        lock={lockTarget}
        canViewEmployeeAttendance={canReadAttendance}
        onClose={() => setLockTarget(null)}
        onLocked={(result) => {
          invalidateAll();
          setSuccessMessage(
            `Period ${periodLabel(result.lock)} locked. ${result.affectedSummaryCount} daily attendance record(s) were newly locked (${result.lock.summaryCount ?? 0} in the period). This is not payroll approval.`,
          );
          setLockTarget(null);
        }}
      />

      {/* ---- Unlock (reason required) ---- */}
      <ReasonDialog
        key={unlockTarget?.id ?? 'closed'}
        open={unlockTarget !== null}
        title={unlockTarget ? `Unlock ${periodLabel(unlockTarget)}?` : 'Unlock period'}
        description="Warning: unlocking reopens these dates. Attendance can then be recalculated and corrected, which may change figures already reviewed for payroll. The reason is stored in the audit log."
        confirmLabel="Unlock period"
        isLoading={unlockMutation.isPending}
        error={unlockMutation.isError ? (describeApiError(unlockMutation.error, 'Could not unlock the period.') ?? undefined) : undefined}
        onConfirm={(reason) => {
          if (unlockTarget) unlockMutation.mutate({ lock: unlockTarget, reason });
        }}
        onCancel={() => {
          if (!unlockMutation.isPending) setUnlockTarget(null);
        }}
      />

      {/* ---- Details ---- */}
      <FormModal open={viewLock !== null} title="Payroll period details" onClose={() => setViewLock(null)}>
        {viewLock ? (
          <div className="flex flex-col">
            <DetailRow label="Period" value={periodLabel(viewLock)} />
            <DetailRow label="Days" value={dayCount(viewLock)} />
            <DetailRow
              label="Status"
              value={<StatusBadge label={LOCK_STATUS_LABELS[viewLock.status]} tone={LOCK_STATUS_TONES[viewLock.status]} />}
            />
            <DetailRow label="Reason" value={viewLock.reason ?? NOT_CALCULATED} />
            <DetailRow label="Notes" value={viewLock.notes ?? NOT_CALCULATED} />
            <DetailRow label="Created" value={formatKuwaitDateTime(viewLock.createdAt)} />
            <DetailRow label="Created by (user ID)" value={<span className="font-mono text-xs">{viewLock.createdByUserId ?? NOT_CALCULATED}</span>} />
            <DetailRow label="Last locked" value={formatKuwaitDateTime(viewLock.lockedAt)} />
            <DetailRow label="Locked by (user ID)" value={<span className="font-mono text-xs">{viewLock.lockedByUserId ?? NOT_CALCULATED}</span>} />
            <DetailRow label="Daily records in period at lock" value={viewLock.summaryCount ?? NOT_CALCULATED} />
            <DetailRow label="Last reopened" value={formatKuwaitDateTime(viewLock.reopenedAt)} />
            <DetailRow label="Reopened by (user ID)" value={<span className="font-mono text-xs">{viewLock.reopenedByUserId ?? NOT_CALCULATED}</span>} />
            <DetailRow label="Reopen reason" value={viewLock.reopenReason ?? NOT_CALCULATED} />
            <p className="mt-3 text-sm text-muted-foreground">
              This record shows only the most recent lock and reopen. The full history of every lock and unlock is in the
              audit log (entity “AttendancePayrollLock”).
              {canReadAudit ? (
                <>
                  {' '}
                  <Link href="/audit-logs" className="font-medium text-accent hover:underline">
                    Open Audit Logs
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        ) : null}
      </FormModal>
    </div>
  );
}
