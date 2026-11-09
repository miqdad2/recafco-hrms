'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Lock, RefreshCw } from 'lucide-react';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormModal } from '@/components/admin/form-modal';
import { Spinner } from '@/components/admin/spinner';
import { Notice } from '@/components/payroll/payroll-ui';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import {
  getPayrollLockReadiness,
  lockPayrollPeriod,
  type PayrollClosingReadiness,
  type PayrollLock,
  type PayrollLockActionResult,
} from '@/lib/api/payroll-locks';
import { formatKuwaitDateTime, formatWorkDate, readinessDescription, readinessLabel } from '@/lib/payroll-attendance/display';
import { describeApiError } from '@/lib/payroll-attendance/errors';
import { cn } from '@/lib/utils';

const LOCK_WARNING =
  'Locking this period prevents attendance records from being recalculated or approved through normal correction workflows. Review unresolved attendance issues before continuing.';

/** Client-side signal: the pre-confirmation re-check found the period is no longer ready. */
class ReadinessChangedError extends Error {}

interface LockReadinessDialogProps {
  lock: PayrollLock | null;
  canViewEmployeeAttendance: boolean;
  onClose: () => void;
  onLocked: (result: PayrollLockActionResult) => void;
}

/**
 * Unit 21.1 — Lock confirmation driven by the backend readiness endpoint.
 * The Lock button follows readiness, but it is only a guide: the server re-evaluates readiness
 * inside the lock transaction and refuses with 409 PAYROLL_PERIOD_NOT_READY. There is no override.
 */
export function LockReadinessDialog({ lock, canViewEmployeeAttendance, onClose, onLocked }: LockReadinessDialogProps) {
  const queryClient = useQueryClient();
  const queryKey = ['payroll-locks', 'readiness', lock?.id];

  const readinessQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => getPayrollLockReadiness(lock?.id as string, signal),
    enabled: lock !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const [step, setStep] = React.useState<'idle' | 'rechecking' | 'locking'>('idle');
  const lockMutation = useMutation({
    retry: false,
    mutationFn: async (target: PayrollLock) => {
      // Refresh readiness immediately before the lock is submitted.
      setStep('rechecking');
      const fresh = await getPayrollLockReadiness(target.id);
      queryClient.setQueryData(['payroll-locks', 'readiness', target.id], fresh);
      if (!fresh.ready) throw new ReadinessChangedError();
      setStep('locking');
      return lockPayrollPeriod(target.id);
    },
    onSuccess: (result) => onLocked(result),
    onError: (error) => {
      // The server refused (readiness changed between check and lock): show the new state.
      if (error instanceof ApiError && error.status === 409) void readinessQuery.refetch();
    },
    onSettled: () => setStep('idle'),
  });

  const readiness = readinessQuery.data;
  const busy = lockMutation.isPending;
  const canSubmit = Boolean(readiness?.ready) && !readinessQuery.isFetching && !busy;

  let mutationError: string | null = null;
  if (lockMutation.error instanceof ReadinessChangedError) {
    mutationError = 'Attendance changed since this check was opened: the period is no longer ready. Review the issues below.';
  } else if (lockMutation.isError) {
    mutationError = describeApiError(lockMutation.error, 'Could not lock the period.');
  }

  return (
    <FormModal
      open={lock !== null}
      title="Lock payroll period"
      className="max-w-3xl"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {lock ? (
        <div className="flex flex-col gap-4">
          <p className="text-base font-medium text-foreground">
            {formatWorkDate(lock.periodStart)} – {formatWorkDate(lock.periodEnd)}
          </p>
          <Notice tone="warning" title="Before you lock">
            {LOCK_WARNING}
          </Notice>

          {readinessQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-md border border-border p-4 text-sm text-muted-foreground">
              <Spinner /> Checking every employee and day in this period. This can take several seconds…
            </div>
          ) : readinessQuery.isError ? (
            <ErrorAlert message={describeApiError(readinessQuery.error, 'Could not check readiness.') ?? ''} />
          ) : readiness ? (
            <ReadinessPanel readiness={readiness} fetching={readinessQuery.isFetching} canViewEmployeeAttendance={canViewEmployeeAttendance} />
          ) : null}

          {mutationError ? <ErrorAlert message={mutationError} /> : null}

          <p className="text-xs text-muted-foreground">
            The server checks readiness again when you lock and refuses if anything is unresolved. Locking is not payroll
            approval and nobody can override the check.
          </p>

          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="outline" onClick={() => void readinessQuery.refetch()} disabled={readinessQuery.isFetching || busy}>
              <RefreshCw className="h-4 w-4" /> Check again
            </Button>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="lg" onClick={() => lockMutation.mutate(lock)} disabled={!canSubmit}>
              {step === 'rechecking' ? (
                <>
                  <Spinner /> Re-checking readiness…
                </>
              ) : step === 'locking' ? (
                <>
                  <Spinner /> Locking…
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" /> Lock period
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </FormModal>
  );
}

function ReadinessPanel({
  readiness,
  fetching,
  canViewEmployeeAttendance,
}: {
  readiness: PayrollClosingReadiness;
  fetching: boolean;
  canViewEmployeeAttendance: boolean;
}) {
  const types = Object.entries(readiness.issuesByType)
    .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== undefined)
    .sort(([, a], [, b]) => (a.severity === b.severity ? b.employeeDays - a.employeeDays : a.severity === 'BLOCKING' ? -1 : 1));

  return (
    <div className={cn('flex flex-col gap-4', fetching && 'opacity-60')} aria-busy={fetching}>
      {readiness.ready ? (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
          <div>
            <p className="text-lg font-semibold text-success">Ready to lock</p>
            <p className="text-sm text-foreground/80">No blocking attendance issues were found. This is not payroll approval.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-error/30 bg-error/10 p-4">
          <CircleAlert className="mt-0.5 h-6 w-6 shrink-0 text-error" aria-hidden />
          <div>
            <p className="text-lg font-semibold text-error">Not ready — this period cannot be locked</p>
            <p className="text-sm text-foreground/80">
              {readiness.blockingIssueCount.toLocaleString()} blocking issue(s)
              {readiness.affectedEmployees > 0
                ? ` across ${readiness.affectedEmployees.toLocaleString()} employee(s) and ${readiness.affectedEmployeeDays.toLocaleString()} employee-day(s)`
                : ''}
              . Resolve them, then check again.
            </p>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ['Employees checked', readiness.employeesEvaluated],
          ['Employee-days checked', readiness.employeeDaysEvaluated],
          ['Blocking issues', readiness.blockingIssueCount],
          ['Warnings', readiness.warningCount],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-md bg-surface-muted p-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums text-foreground">{Number(value).toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      {types.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Issues by type</h3>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {types.map(([code, info]) => (
              <li key={code} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-xs font-semibold',
                        info.severity === 'BLOCKING' ? 'border-error/30 bg-error/10 text-error' : 'border-warning/30 bg-warning/10 text-warning',
                      )}
                    >
                      {info.severity === 'BLOCKING' ? 'Blocking' : 'Warning'}
                    </span>
                    {readinessLabel(code)}
                  </span>
                  <span className="text-xs text-muted-foreground">{readinessDescription(code)}</span>
                  <span className="font-mono text-[11px] text-subtle-foreground">{code}</span>
                </span>
                <span className="shrink-0 text-right tabular-nums text-foreground">
                  {info.employees > 0
                    ? `${info.employeeDays.toLocaleString()} day(s) · ${info.employees.toLocaleString()} employee(s)`
                    : 'Whole period'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {readiness.sampleIssues.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {readiness.sampleTruncated
              ? `First ${readiness.sampleIssues.length} employee-days with issues (more exist — counts above are complete)`
              : 'Employee-days with issues'}
          </h3>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {readiness.sampleIssues.map((issue) => (
                  <tr key={`${issue.employeeId}-${issue.workDate}`}>
                    <td className="px-3 py-2">
                      {canViewEmployeeAttendance ? (
                        <Link
                          href={`/payroll-attendance/${issue.employeeId}?month=${issue.workDate.slice(0, 7)}`}
                          className="font-medium text-accent hover:underline"
                        >
                          {issue.employeeName}
                        </Link>
                      ) : (
                        <span className="font-medium">{issue.employeeName}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">{issue.employeeCode}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatWorkDate(issue.workDate)}</td>
                    <td className="px-3 py-2">{issue.codes.map(readinessLabel).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Checked {formatKuwaitDateTime(readiness.evaluatedAt)} · exact dates {readiness.periodStart} to {readiness.periodEnd} ·
        rules {readiness.rulesVersion}. Scheduled working days are not known yet (no working calendar).
      </p>
    </div>
  );
}
