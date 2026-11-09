'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, RefreshCw } from 'lucide-react';
import { AccessDenied } from '@/components/admin/access-denied';
import { DetailRow } from '@/components/admin/detail-row';
import { ErrorAlert } from '@/components/admin/error-alert';
import { TableSkeleton } from '@/components/admin/loading-skeleton';
import { Spinner } from '@/components/admin/spinner';
import { ExceptionChip, ExceptionList, MonthPicker, Notice, ReviewStatusBadge, StatCard, StatCardSkeleton } from '@/components/payroll/payroll-ui';
import { Button, buttonVariants } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { getEmployeeMonthlyAttendance, type DailyBreakdown, type OfficialPunchInfo } from '@/lib/api/payroll-attendance';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';
import {
  CALENDAR_NOTE_LABELS,
  COVERAGE_LABELS,
  DAY_CLASSIFICATION_LABELS,
  DAY_CLASSIFICATION_TONES,
  NOT_CALCULATED,
  REVIEW_STATUS_DESCRIPTIONS,
  currentKuwaitMonth,
  dailyStatusLabel,
  dailyStatusTone,
  formatKuwaitTime,
  formatMinutes,
  formatMonth,
  formatWorkDate,
  isValidMonth,
  sourceLabel,
  weekdayOf,
} from '@/lib/payroll-attendance/display';
import { describeApiError } from '@/lib/payroll-attendance/errors';
import { cn } from '@/lib/utils';

const ID_PATTERN = /^[a-z0-9]{20,32}$/i;

export default function EmployeeMonthlyAttendancePage() {
  return (
    <React.Suspense fallback={<div className="flex justify-center p-12"><Spinner /></div>}>
      <EmployeeMonthView />
    </React.Suspense>
  );
}

/** Kuwait calendar date (YYYY-MM-DD) of an instant — used to flag an OUT that falls on the next day. */
function kuwaitDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

function PunchCell({ punch, workDate }: { punch: OfficialPunchInfo | null; workDate: string }) {
  if (!punch?.time) {
    return <span className="text-muted-foreground">{NOT_CALCULATED}</span>;
  }
  const nextDay = kuwaitDate(punch.time) !== workDate;
  return (
    <span className="flex flex-col">
      <span className="font-medium tabular-nums">
        {formatKuwaitTime(punch.time)}
        {nextDay ? <span className="ml-1 text-xs text-muted-foreground">({formatWorkDate(kuwaitDate(punch.time))})</span> : null}
      </span>
      <span className="text-xs text-muted-foreground">{sourceLabel(punch.sourceType)}</span>
    </span>
  );
}

function DayStatus({ day }: { day: DailyBreakdown }) {
  return (
    <span className="flex flex-col items-start gap-1">
      {day.attendanceStatus ? (
        <StatusBadge label={dailyStatusLabel(day.attendanceStatus)} tone={dailyStatusTone(day.attendanceStatus)} className="text-sm" />
      ) : (
        <StatusBadge label={COVERAGE_LABELS[day.coverage]} tone={day.coverage === 'NOT_EMPLOYED' ? 'muted' : 'error'} className="text-sm" />
      )}
      {day.payrollLocked ? (
        <span className="inline-flex items-center gap-1 text-xs text-locked">
          <Lock className="h-3 w-3" aria-hidden /> Locked period
        </span>
      ) : null}
    </span>
  );
}

function EmployeeMonthView() {
  const { user } = useAuth();
  const params = useParams<{ employeeId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canRead = hasPermission(user, 'payrollAttendance.read');

  const employeeId = typeof params.employeeId === 'string' && ID_PATTERN.test(params.employeeId) ? params.employeeId : null;
  const monthParam = searchParams.get('month');
  const month = isValidMonth(monthParam) ? monthParam : currentKuwaitMonth();
  const [attentionOnly, setAttentionOnly] = React.useState(false);
  const [showCodes, setShowCodes] = React.useState(false);

  const query = useQuery({
    queryKey: ['payroll-attendance', 'employee', employeeId, month],
    queryFn: ({ signal }) => getEmployeeMonthlyAttendance(employeeId as string, month, signal),
    enabled: canRead && employeeId !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const backHref = `/payroll-attendance?month=${month}`;
  const data = query.data;
  const error = !employeeId
    ? 'This employee link is not valid.'
    : query.isError
      ? describeApiError(query.error, 'Could not load this employee’s monthly attendance.')
      : null;

  const days = data?.dailyBreakdown ?? [];
  const attentionDays = days.filter((day) => day.coverage !== 'NOT_EMPLOYED' && day.exceptions.length > 0);
  const visibleDays = attentionOnly ? attentionDays : days;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Monthly Attendance
        </Link>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {data ? data.employee.name : 'Employee monthly attendance'}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-base text-muted-foreground">
            {data ? <span>{data.employee.employeeCode}</span> : null}
            <span>{formatMonth(month)}</span>
            {data ? <ReviewStatusBadge status={data.reviewStatus} /> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker
            value={month}
            onChange={(value) => router.replace(`${pathname}?month=${value}`, { scroll: false })}
          />
          <Button size="lg" onClick={() => void query.refetch()} disabled={query.isFetching || !employeeId}>
            {query.isFetching ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            {query.isFetching ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error ? <ErrorAlert message={error} /> : null}

      {query.isLoading ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <StatCardSkeleton key={index} />
            ))}
          </div>
          <TableSkeleton rows={10} columns={8} />
        </>
      ) : null}

      {data ? (
        <div className={cn('flex flex-col gap-6', query.isFetching && 'opacity-60')} aria-busy={query.isFetching}>
          <Notice
            tone={data.reviewStatus === 'CALCULATED' ? 'success' : data.reviewStatus === 'LOCKED' ? 'locked' : data.reviewStatus === 'INCOMPLETE' ? 'error' : 'warning'}
            title={REVIEW_STATUS_DESCRIPTIONS[data.reviewStatus]}
          >
            {data.days.unresolvedDays > 0
              ? `${data.days.unresolvedDays} day(s) could not be calculated and ${data.days.daysWithWarnings} day(s) have warnings. Use “Only days needing attention” below to see them.`
              : data.days.daysWithWarnings > 0
                ? `${data.days.daysWithWarnings} day(s) have warnings to review.`
                : 'No issues were found for this month.'}
          </Notice>

          {/* Totals */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Required Hours"
              value={formatMinutes(data.totals.requiredMinutes ?? data.totals.requiredMinutesDeterminable)}
              partial={data.totals.requiredMinutes === null}
              hint="Shift length on attended days with a valid shift"
            />
            <StatCard
              label="Worked Hours"
              value={formatMinutes(data.totals.verifiedWorkedMinutes)}
              partial={data.totals.shortageMinutes === null}
              hint="Verified days only"
            />
            <StatCard
              label="Shortage"
              value={formatMinutes(data.totals.shortageMinutes ?? data.totals.verifiedShortageMinutes)}
              partial={data.totals.shortageMinutes === null}
              tone={data.totals.shortageMinutes !== null && data.totals.shortageMinutes > 0 ? 'warning' : undefined}
              hint="Includes late arrival and early departure"
            />
            <StatCard label="Late" value={formatMinutes(data.totals.lateMinutes)} hint={`${data.days.lateDays} late day(s) · already inside shortage`} />
            <StatCard label="Early Departure" value={formatMinutes(data.totals.earlyLeaveMinutes)} hint="Already inside shortage" />
            <StatCard
              label="Overtime"
              value={formatMinutes(data.totals.overtimeMinutesInformational)}
              hint="Information only — not approved overtime"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-base font-semibold text-foreground">Employee</h2>
              <DetailRow label="Name" value={data.employee.name} />
              <DetailRow label="Code" value={data.employee.employeeCode} />
              <DetailRow label="Department" value={data.employee.department?.name ?? NOT_CALCULATED} />
              <DetailRow label="Designation" value={data.employee.designation?.title ?? NOT_CALCULATED} />
              <DetailRow label="Work location" value={data.employee.workLocation?.name ?? NOT_CALCULATED} />
              <DetailRow label="Employee status" value={data.employee.status} />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-base font-semibold text-foreground">Days</h2>
              <DetailRow label="Employment days" value={`${data.days.employmentDays} of ${data.days.calendarDays}`} />
              <DetailRow label="Present days" value={data.days.presentDays} />
              <DetailRow label="Late days" value={data.days.lateDays} />
              <DetailRow label="Absent days" value={data.days.absentDays} />
              <DetailRow label="Missing punch days" value={data.days.missingPunchDays} />
              <DetailRow label="No attendance record" value={data.days.missingSummaryDays} />
              <DetailRow label="No shift assigned" value={data.days.noShiftDays} />
              <DetailRow label="Rest days" value={data.days.restDays} />
              <DetailRow label="Public holidays" value={data.days.publicHolidayDays} />
              <DetailRow
                label="Scheduled working days"
                value={
                  data.days.scheduledWorkingDays !== null ? (
                    data.days.scheduledWorkingDays
                  ) : (
                    <span title="Some days have no approved working calendar">{NOT_CALCULATED} {data.days.unknownCalendarDays} day(s) without calendar</span>
                  )
                }
              />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-base font-semibold text-foreground">Pending and locked</h2>
              <DetailRow label="Corrections awaiting approval" value={data.exceptions.pendingCorrections} />
              <DetailRow label="Punches awaiting review" value={data.exceptions.pendingReviewPunches} />
              <DetailRow label="Rejected punch attempts" value={data.exceptions.rejectedPunches} />
              <DetailRow label="Days needing attention" value={data.days.unresolvedDays} />
              <DetailRow label="Days with warnings" value={data.days.daysWithWarnings} />
              <DetailRow
                label="Payroll lock"
                value={
                  data.payrollLock.fullyLocked
                    ? 'Whole month locked'
                    : data.payrollLock.overlapsLockedPeriod
                      ? `${data.payrollLock.lockedDates.length} day(s) locked`
                      : 'Not locked'
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">Issues this month</h2>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={showCodes} onChange={(event) => setShowCodes(event.target.checked)} className="h-4 w-4" />
                Show technical codes
              </label>
            </div>
            <ExceptionList codes={data.exceptions.codes} counts={data.exceptions.dayCountsByCode} showCode={showCodes} />
          </div>

          {/* Daily breakdown */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">Daily breakdown</h2>
              <div className="flex rounded-md border border-border bg-surface p-1" role="group" aria-label="Which days to show">
                <Button variant={attentionOnly ? 'ghost' : 'default'} size="sm" onClick={() => setAttentionOnly(false)}>
                  All days ({days.length})
                </Button>
                <Button variant={attentionOnly ? 'default' : 'ghost'} size="sm" onClick={() => setAttentionOnly(true)}>
                  Only days needing attention ({attentionDays.length})
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Times are Kuwait time. Check In and Check Out can come from different sources (for example Mobile IN and
              Biometric OUT) — both are valid.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">Day type</th>
                    <th className="px-3 py-3">Shift</th>
                    <th className="px-3 py-3">Check In</th>
                    <th className="px-3 py-3">Check Out</th>
                    <th className="px-3 py-3">Worked</th>
                    <th className="px-3 py-3">Required</th>
                    <th className="px-3 py-3">Shortage</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleDays.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                        No days need attention this month.
                      </td>
                    </tr>
                  ) : null}
                  {visibleDays.map((day) => {
                    const notEmployed = day.coverage === 'NOT_EMPLOYED';
                    const hasWarnings = !day.blocking && day.exceptions.length > 0;
                    return (
                      <tr
                        key={day.workDate}
                        className={cn(
                          'border-l-4',
                          notEmployed
                            ? 'border-l-transparent bg-surface-muted/40 text-muted-foreground'
                            : day.blocking
                              ? 'border-l-error'
                              : hasWarnings
                                ? 'border-l-warning'
                                : 'border-l-transparent',
                        )}
                      >
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="flex flex-col">
                            <span className="font-medium">{formatWorkDate(day.workDate)}</span>
                            <span className="text-xs text-muted-foreground">{weekdayOf(day.workDate)}</span>
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className="flex flex-col items-start gap-1"
                            title={[...day.calendar.conflicts, ...day.calendar.warnings].map((c) => CALENDAR_NOTE_LABELS[c] ?? c).join('\n')}
                          >
                            <StatusBadge
                              label={DAY_CLASSIFICATION_LABELS[day.calendar.classification] ?? day.calendar.classification}
                              tone={DAY_CLASSIFICATION_TONES[day.calendar.classification] ?? 'muted'}
                              className="text-sm"
                            />
                            {day.calendar.holiday ? <span className="text-xs text-info">{day.calendar.holiday.name}</span> : null}
                            {day.calendar.conflicts.length > 0 ? <span className="text-xs text-error">Calendar conflict</span> : null}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {day.shift ? (
                            <span className="flex flex-col">
                              <span className="font-medium">{day.shift.name}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {day.shift.startTime}–{day.shift.endTime}
                                {day.shift.isOvernight ? ' (overnight)' : ''}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{notEmployed ? NOT_CALCULATED : 'No shift'}</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <PunchCell punch={day.officialIn} workDate={day.workDate} />
                        </td>
                        <td className="px-3 py-3">
                          <PunchCell punch={day.officialOut} workDate={day.workDate} />
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          {day.workedMinutes !== null ? (
                            <span className="font-medium">{formatMinutes(day.workedMinutes)}</span>
                          ) : day.recordedWorkedMinutes !== null && day.recordedWorkedMinutes > 0 ? (
                            <span className="flex flex-col" title="Recorded in the daily summary but not verified because the day has an open issue.">
                              <span className="text-muted-foreground">{NOT_CALCULATED}</span>
                              <span className="text-xs text-warning">Unverified: {formatMinutes(day.recordedWorkedMinutes)}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{NOT_CALCULATED}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 tabular-nums">{formatMinutes(day.requiredMinutes)}</td>
                        <td className="px-3 py-3 tabular-nums">
                          <span className={cn(day.shortageMinutes !== null && day.shortageMinutes > 0 && 'font-medium text-warning')}>
                            {formatMinutes(day.shortageMinutes)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <DayStatus day={day} />
                        </td>
                        <td className="px-3 py-3">
                          {day.exceptions.length > 0 ? (
                            <div className="flex max-w-[16rem] flex-wrap gap-1">
                              {day.exceptions.map((code) => (
                                <ExceptionChip key={code} code={code} showCode={showCodes} />
                              ))}
                            </div>
                          ) : notEmployed ? null : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Loaded {new Date(query.dataUpdatedAt).toLocaleTimeString()} · rules {data.rulesVersion}. “—” means the
              value cannot be calculated; it is never shown as zero.{' '}
              <Link href={backHref} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-auto p-0 text-accent')}>
                Back to list
              </Link>
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
