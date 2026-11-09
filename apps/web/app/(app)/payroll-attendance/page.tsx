'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, CircleAlert, Clock, Hourglass, Lock, RefreshCw, TriangleAlert, Users, X } from 'lucide-react';
import { AccessDenied } from '@/components/admin/access-denied';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { ErrorAlert } from '@/components/admin/error-alert';
import { SearchInput } from '@/components/admin/search-input';
import { Spinner } from '@/components/admin/spinner';
import {
  ExceptionList,
  MonthPicker,
  Notice,
  ReviewStatusBadge,
  StatCard,
  StatCardSkeleton,
} from '@/components/payroll/payroll-ui';
import { Button, buttonVariants } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { listDepartments } from '@/lib/api/departments';
import { listEmployees } from '@/lib/api/employees';
import {
  getMonthlyAttendanceSummary,
  listMonthlyAttendance,
  type MonthExceptionCode,
  type MonthlyAttendanceFilter,
  type MonthlyEmployeeRecord,
} from '@/lib/api/payroll-attendance';
import { listWorkLocations } from '@/lib/api/work-locations';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';
import {
  NOT_CALCULATED,
  currentKuwaitMonth,
  exceptionLabel,
  formatMinutes,
  formatMonth,
  isValidMonth,
} from '@/lib/payroll-attendance/display';
import { describeApiError } from '@/lib/payroll-attendance/errors';
import { cn } from '@/lib/utils';

const ID_PATTERN = /^[a-z0-9]{20,32}$/i;
const PAGE_SIZES = [20, 50, 100] as const;

function idParam(value: string | null): string | undefined {
  return value && ID_PATTERN.test(value) ? value : undefined;
}

export default function PayrollAttendancePage() {
  // useSearchParams needs a Suspense boundary for the Next.js production build.
  return (
    <React.Suspense fallback={<div className="flex justify-center p-12"><Spinner /></div>}>
      <MonthlyAttendanceView />
    </React.Suspense>
  );
}

/** Hours value for a table cell: complete value, or "—" plus the known-so-far figure when incomplete. */
function HoursCell({ value, knownSoFar, reason }: { value: number | null; knownSoFar?: number; reason: string }) {
  if (value !== null) {
    return <span className="font-medium tabular-nums">{formatMinutes(value)}</span>;
  }
  return (
    <span className="flex flex-col" title={reason}>
      <span className="font-medium text-muted-foreground">{NOT_CALCULATED} Not calculated</span>
      {knownSoFar !== undefined && knownSoFar > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">Known so far: {formatMinutes(knownSoFar)}</span>
      ) : null}
    </span>
  );
}

function MonthlyAttendanceView() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'payrollAttendance.read');
  const canReadDepartments = hasPermission(user, 'departments.read');
  const canReadLocations = hasPermission(user, 'workLocations.read');
  const canSearchEmployees = hasPermission(user, 'employees.read');

  // ---- URL-backed state (shareable, survives refresh and back/forward) ----
  const monthParam = searchParams.get('month');
  const month = isValidMonth(monthParam) ? monthParam : currentKuwaitMonth();
  const departmentId = idParam(searchParams.get('departmentId'));
  const workLocationId = idParam(searchParams.get('workLocationId'));
  const employeeId = idParam(searchParams.get('employeeId'));
  const pageParam = Number(searchParams.get('page'));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const limitParam = Number(searchParams.get('limit'));
  const limit = (PAGE_SIZES as readonly number[]).includes(limitParam) ? limitParam : 20;

  const updateParams = React.useCallback(
    (patch: Record<string, string | undefined>, resetPage = true) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (resetPage) next.delete('page');
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const filter: MonthlyAttendanceFilter = { month, employeeId, departmentId, workLocationId };

  // ---- Company-wide summary: ~4 s at 2,000 employees. One request per filter set, never polled,
  // never retried automatically, not kept after unmount (no caching of payroll totals). ----
  const summaryQuery = useQuery({
    queryKey: ['payroll-attendance', 'summary', filter],
    queryFn: ({ signal }) => getMonthlyAttendanceSummary(filter, signal),
    enabled: canRead,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const listQuery = useQuery({
    queryKey: ['payroll-attendance', 'list', filter, page, limit],
    queryFn: ({ signal }) => listMonthlyAttendance({ ...filter, page, limit }, signal),
    enabled: canRead,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active-for-dropdown'],
    queryFn: () => listDepartments({ isActive: true, limit: 100 }),
    enabled: canRead && canReadDepartments,
  });
  const locationsQuery = useQuery({
    queryKey: ['work-locations', 'active-for-dropdown'],
    queryFn: () => listWorkLocations({ isActive: true, limit: 100 }),
    enabled: canRead && canReadLocations,
  });

  // ---- Employee search: the monthly endpoints have no name/code search, so we search the
  // employees directory (server-side, debounced) and filter the monthly view by employeeId. ----
  const [employeeSearch, setEmployeeSearch] = React.useState('');
  const [selectedEmployeeLabel, setSelectedEmployeeLabel] = React.useState<string | null>(null);
  const employeeSearchQuery = useQuery({
    queryKey: ['employees', 'payroll-attendance-search', employeeSearch],
    queryFn: () => listEmployees({ search: employeeSearch, limit: 8 }),
    enabled: canRead && canSearchEmployees && employeeSearch.trim().length >= 2 && !employeeId,
  });

  const isFetching = summaryQuery.isFetching || listQuery.isFetching;

  function refresh() {
    void queryClient.refetchQueries({ queryKey: ['payroll-attendance'], type: 'active' });
  }

  if (!canRead) {
    return <AccessDenied />;
  }

  const summary = summaryQuery.data;
  const summaryError = summaryQuery.isError ? describeApiError(summaryQuery.error, 'Could not load the monthly totals.') : null;
  const listError = listQuery.isError ? describeApiError(listQuery.error, 'Could not load the employee list.') : null;

  const listedEmployee = employeeId ? listQuery.data?.data.find((row) => row.employee.id === employeeId) : undefined;
  const employeeChipLabel =
    selectedEmployeeLabel ?? (listedEmployee ? `${listedEmployee.employee.name} (${listedEmployee.employee.employeeCode})` : 'Selected employee');

  const columns: DataTableColumn<MonthlyEmployeeRecord>[] = [
    {
      key: 'employee',
      header: 'Employee',
      render: (row) => (
        <div className="flex min-w-[12rem] flex-col">
          <span className="font-medium text-foreground">{row.employee.name}</span>
          <span className="text-xs text-muted-foreground">
            {row.employee.employeeCode}
            {row.employee.department ? ` · ${row.employee.department.name}` : ' · No department'}
          </span>
        </div>
      ),
    },
    {
      key: 'required',
      header: 'Required',
      render: (row) => (
        <HoursCell
          value={row.totals.requiredMinutes}
          knownSoFar={row.totals.requiredMinutesDeterminable}
          reason="Required hours cannot be established for every day of this month (for example, no shift or no attendance record)."
        />
      ),
    },
    {
      key: 'worked',
      header: 'Worked',
      render: (row) =>
        row.reviewStatus === 'INCOMPLETE' ? (
          <span className="flex flex-col" title="Only verified days are counted; some days could not be calculated.">
            <span className="font-medium tabular-nums">{formatMinutes(row.totals.verifiedWorkedMinutes)}</span>
            <span className="text-xs text-warning">Known so far</span>
          </span>
        ) : (
          <span className="font-medium tabular-nums">{formatMinutes(row.totals.verifiedWorkedMinutes)}</span>
        ),
    },
    {
      key: 'shortage',
      header: 'Shortage',
      render: (row) => (
        <HoursCell
          value={row.totals.shortageMinutes}
          knownSoFar={row.totals.verifiedShortageMinutes}
          reason="Shortage is only shown when every day of the month could be verified."
        />
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <ReviewStatusBadge status={row.reviewStatus} /> },
    {
      key: 'exceptions',
      header: 'Issues',
      className: 'max-w-[18rem]',
      render: (row) => (
        <ExceptionList codes={row.exceptions.codes} counts={row.exceptions.dayCountsByCode} max={3} />
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <Link
          href={`/payroll-attendance/${row.employee.id}?month=${month}`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          View details
        </Link>
      ),
    },
  ];

  const statusCounts = summary?.reviewStatusCounts;
  const totalsComplete = summary ? summary.totals.shortageMinutes !== null : false;
  const employeesByCode = summary?.exceptions.employeesByCode ?? {};
  const issueCodes = (Object.keys(employeesByCode) as MonthExceptionCode[]).sort(
    (a, b) => (employeesByCode[b] ?? 0) - (employeesByCode[a] ?? 0),
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Header ---- */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Monthly Attendance</h1>
          <p className="text-base text-muted-foreground">
            {formatMonth(month)} · Attendance review in hours and days. This page does not calculate salary and does
            not approve payroll.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={month} onChange={(value) => updateParams({ month: value })} />
          <Button onClick={refresh} disabled={isFetching} size="lg">
            {isFetching ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            {isFetching ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* ---- Filters ---- */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        {canSearchEmployees ? (
          <div className="relative flex flex-col gap-1">
            <span className="text-sm font-medium text-muted-foreground">Employee</span>
            {employeeId ? (
              <span className="inline-flex h-10 items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 text-sm font-medium text-foreground">
                {employeeChipLabel}
                <button
                  type="button"
                  aria-label="Clear employee filter"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setSelectedEmployeeLabel(null);
                    setEmployeeSearch('');
                    updateParams({ employeeId: undefined });
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            ) : (
              <>
                <SearchInput value={employeeSearch} onChange={setEmployeeSearch} placeholder="Search name or code…" />
                {employeeSearch.trim().length >= 2 ? (
                  <div className="absolute top-full z-20 mt-1 w-80 rounded-md border border-border bg-surface shadow-lg">
                    {employeeSearchQuery.isLoading ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                        <Spinner /> Searching…
                      </div>
                    ) : (employeeSearchQuery.data?.data ?? []).length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No matching employees.</div>
                    ) : (
                      (employeeSearchQuery.data?.data ?? []).map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-surface-muted"
                          onClick={() => {
                            setSelectedEmployeeLabel(`${employee.fullName} (${employee.employeeCode})`);
                            updateParams({ employeeId: employee.id });
                          }}
                        >
                          <span className="font-medium text-foreground">{employee.fullName}</span>
                          <span className="text-xs text-muted-foreground">
                            {employee.employeeCode}
                            {employee.department?.name ? ` · ${employee.department.name}` : ''}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {canReadDepartments ? (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-muted-foreground">Department</span>
            <Select
              value={departmentId ?? ''}
              onChange={(event) => updateParams({ departmentId: event.target.value || undefined })}
              className="w-56"
            >
              <option value="">All departments</option>
              {(departmentsQuery.data?.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {canReadLocations ? (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-muted-foreground">Work location</span>
            <Select
              value={workLocationId ?? ''}
              onChange={(event) => updateParams({ workLocationId: event.target.value || undefined })}
              className="w-56"
            >
              <option value="">All work locations</option>
              {(locationsQuery.data?.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {departmentId || workLocationId || employeeId ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSelectedEmployeeLabel(null);
              setEmployeeSearch('');
              updateParams({ departmentId: undefined, workLocationId: undefined, employeeId: undefined });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {/* ---- Summary cards (company-wide endpoint, never page-derived) ---- */}
      {summaryError ? (
        <div className="flex flex-col gap-2">
          <ErrorAlert message={summaryError} />
          <div>
            <Button variant="outline" onClick={() => void summaryQuery.refetch()}>
              Try again
            </Button>
          </div>
        </div>
      ) : null}

      {summaryQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Calculating totals for all matching employees. This can take a few seconds…
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <StatCardSkeleton key={index} />
            ))}
          </div>
        </div>
      ) : summary && statusCounts ? (
        <div className={cn('flex flex-col gap-4', summaryQuery.isFetching && 'opacity-60')} aria-busy={summaryQuery.isFetching}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Employees" value={summary.employeeCount.toLocaleString()} icon={Users} hint="Employed during this month" />
            <StatCard
              label="Calculated"
              value={statusCounts.CALCULATED.toLocaleString()}
              tone="success"
              icon={CheckCircle2}
              hint="Verified — not payroll approval"
            />
            <StatCard
              label="Needs Review"
              value={statusCounts.NEEDS_REVIEW.toLocaleString()}
              tone="warning"
              icon={TriangleAlert}
              hint="Warnings to review"
            />
            <StatCard
              label="Incomplete"
              value={statusCounts.INCOMPLETE.toLocaleString()}
              tone="error"
              icon={CircleAlert}
              hint="Some days cannot be calculated"
            />
            <StatCard
              label="Locked"
              value={statusCounts.LOCKED.toLocaleString()}
              tone="locked"
              icon={Lock}
              hint="Fully in a locked period"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Required Hours"
              value={formatMinutes(summary.totals.requiredMinutes ?? summary.totals.requiredMinutesDeterminable)}
              partial={summary.totals.requiredMinutes === null}
              icon={CalendarClock}
              hint={
                summary.totals.requiredMinutes === null
                  ? 'Only days where the requirement is known'
                  : 'All employment days'
              }
            />
            <StatCard
              label="Worked Hours"
              value={formatMinutes(summary.totals.verifiedWorkedMinutes)}
              partial={!totalsComplete}
              icon={Clock}
              hint="Verified days only"
            />
            <StatCard
              label="Shortage Hours"
              value={formatMinutes(summary.totals.shortageMinutes ?? summary.totals.verifiedShortageMinutes)}
              partial={summary.totals.shortageMinutes === null}
              tone={summary.totals.shortageMinutes === null ? undefined : 'warning'}
              icon={Hourglass}
              hint={summary.totals.shortageMinutes === null ? 'Verified days only — full total unknown' : 'Whole month'}
            />
            <StatCard
              label="Pending Items"
              value={(summary.exceptions.pendingCorrections + summary.exceptions.pendingReviewPunches).toLocaleString()}
              tone={summary.exceptions.pendingCorrections + summary.exceptions.pendingReviewPunches > 0 ? 'warning' : undefined}
              icon={TriangleAlert}
              hint={`${summary.exceptions.pendingCorrections.toLocaleString()} corrections · ${summary.exceptions.pendingReviewPunches.toLocaleString()} punches awaiting review`}
            />
          </div>

          {summary.payrollLock.overlapsLockedPeriod ? (
            <Notice tone="locked" title={`${summary.payrollLock.lockedDates.length} day(s) of ${formatMonth(month)} are in a locked payroll period.`}>
              Locked days cannot be recalculated or corrected through the normal workflow. Locking is not payroll approval.
            </Notice>
          ) : null}
          {(employeesByCode.REST_DAY_CALENDAR_NOT_CONFIGURED ?? 0) > 0 ? (
            <Notice tone="info" title="Rest days and holidays are not configured yet">
              Days without an attendance record are shown as “No attendance record”, because the system cannot yet tell a
              day off from an absence. Those employees appear as Incomplete until HR defines the rest-day calendar.
            </Notice>
          ) : null}

          {issueCodes.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 text-base font-semibold text-foreground">Issues this month (number of employees affected)</h2>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {issueCodes.map((code) => (
                  <li key={code} className="flex items-center justify-between gap-3 rounded-md bg-surface-muted px-3 py-2 text-sm">
                    <span className="flex flex-col">
                      <span className="font-medium text-foreground">{exceptionLabel(code)}</span>
                      <span className="font-mono text-xs text-muted-foreground">{code}</span>
                    </span>
                    <span className="text-lg font-semibold tabular-nums text-foreground">
                      {(employeesByCode[code] ?? 0).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Totals for all {summary.employeeCount.toLocaleString()} matching employee(s) · loaded{' '}
            {new Date(summaryQuery.dataUpdatedAt).toLocaleTimeString()} · rules {summary.rulesVersion}. Figures do not
            update automatically — use Refresh.
          </p>
        </div>
      ) : null}

      {/* ---- Employee table (server-side pagination) ---- */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Employees</h2>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Rows per page
            <Select
              value={String(limit)}
              onChange={(event) => updateParams({ limit: event.target.value === '20' ? undefined : event.target.value })}
              className="w-24"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {listError ? <ErrorAlert message={listError} /> : null}
        <div className={cn(listQuery.isFetching && !listQuery.isLoading && 'opacity-60')}>
          <DataTable
            columns={columns}
            data={listQuery.data?.data ?? []}
            getRowId={(row) => row.employee.id}
            isLoading={listQuery.isLoading}
            emptyMessage="No employees were employed in this month for the selected filters."
          />
        </div>
        {listQuery.data && listQuery.data.meta.total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
            <span>
              Showing {((listQuery.data.meta.page - 1) * listQuery.data.meta.limit + 1).toLocaleString()}–
              {Math.min(listQuery.data.meta.page * listQuery.data.meta.limit, listQuery.data.meta.total).toLocaleString()} of{' '}
              {listQuery.data.meta.total.toLocaleString()} employees
            </span>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={page <= 1 || listQuery.isFetching}
                onClick={() => updateParams({ page: String(page - 1) }, false)}
              >
                Previous
              </Button>
              <span>
                Page {listQuery.data.meta.page} of {Math.max(listQuery.data.meta.totalPages, 1)}
              </span>
              <Button
                variant="outline"
                disabled={page >= listQuery.data.meta.totalPages || listQuery.isFetching}
                onClick={() => updateParams({ page: String(page + 1) }, false)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
