'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CircleAlert, Plus, RefreshCw, TriangleAlert, Users } from 'lucide-react';
import { AccessDenied } from '@/components/admin/access-denied';
import { DataTable } from '@/components/admin/data-table';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { ReasonDialog } from '@/components/admin/reason-dialog';
import { Spinner } from '@/components/admin/spinner';
import { SuccessBanner } from '@/components/admin/success-banner';
import { MonthPicker, Notice, StatCard, StatCardSkeleton } from '@/components/payroll/payroll-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApprovalDialog, CalendarMonthGrid, EmployeePicker, PolicyStatusBadge } from '@/components/work-calendars/calendar-ui';
import {
  activateDayOverride,
  createDayOverride,
  deactivateDayOverride,
  getCalendarCoverage,
  getEmployeeCalendarPreview,
  listDayOverrides,
  type CalendarDayType,
  type DayOverride,
} from '@/lib/api/work-calendars';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';
import { CALENDAR_NOTE_LABELS, currentKuwaitMonth, formatMinutes, formatMonth, formatWorkDate } from '@/lib/payroll-attendance/display';
import { describeApiError } from '@/lib/payroll-attendance/errors';

export default function CalendarCoveragePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canRead = hasPermission(user, 'workCalendars.read');
  const canManage = hasPermission(user, 'workCalendars.manage');
  const canActivate = hasPermission(user, 'workCalendars.activate');
  const canSearch = hasPermission(user, 'employees.read');
  const [month, setMonth] = React.useState(currentKuwaitMonth());
  const [employee, setEmployee] = React.useState<{ id: string; label: string } | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [form, setForm] = React.useState({ date: '', dayType: 'REST_DAY' as CalendarDayType, reason: '' });
  const [approving, setApproving] = React.useState<DayOverride | null>(null);
  const [deactivating, setDeactivating] = React.useState<DayOverride | null>(null);

  const coverage = useQuery({
    queryKey: ['work-calendars', 'coverage', month],
    queryFn: ({ signal }) => getCalendarCoverage(month, signal),
    enabled: canRead,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const preview = useQuery({
    queryKey: ['work-calendars', 'employee-preview', employee?.id, month],
    queryFn: ({ signal }) => getEmployeeCalendarPreview(employee?.id as string, month, signal),
    enabled: canRead && employee !== null,
  });
  const overrides = useQuery({
    queryKey: ['work-calendars', 'overrides', 'employee', employee?.id],
    queryFn: ({ signal }) => listDayOverrides({ employeeId: employee?.id as string }, signal),
    enabled: canRead && employee !== null,
  });
  const done = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: ['work-calendars'] });
    setSuccess(message);
  };
  const add = useMutation({
    mutationFn: () => createDayOverride({ employeeId: employee?.id, date: form.date, dayType: form.dayType, reason: form.reason }),
    onSuccess: () => {
      setOverrideOpen(false);
      done('Employee day exception saved as a draft. It has no effect until approved.');
    },
  });
  const approve = useMutation({
    mutationFn: (ref: string) => activateDayOverride((approving as DayOverride).id, ref),
    onSuccess: () => {
      setApproving(null);
      done('Day exception approved.');
    },
  });
  const deactivate = useMutation({
    mutationFn: (reason: string) => deactivateDayOverride((deactivating as DayOverride).id, reason),
    onSuccess: () => {
      setDeactivating(null);
      done('Day exception deactivated.');
    },
  });

  if (!canRead) return <AccessDenied />;
  const err = (e: unknown, f: string) => describeApiError(e, f);
  const c = coverage.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Calendar Coverage</h1>
          <p className="text-base text-muted-foreground">{formatMonth(month)} · Which employees have an approved working calendar for every day.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={month} onChange={setMonth} />
          <Button size="lg" onClick={() => void coverage.refetch()} disabled={coverage.isFetching}>
            {coverage.isFetching ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
        </div>
      </div>

      {success ? <SuccessBanner message={success} onDismiss={() => setSuccess(null)} /> : null}
      {coverage.isError ? <ErrorAlert message={err(coverage.error, 'Could not load coverage.') ?? ''} /> : null}

      {coverage.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : c ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Employees this month" value={c.employees.toLocaleString()} icon={Users} />
            <StatCard label="Fully covered" value={c.fullyCoveredEmployees.toLocaleString()} tone="success" icon={CalendarCheck} hint="Every employment day has an approved calendar" />
            <StatCard label="Missing calendar days" value={c.employeesWithUnknownDays.toLocaleString()} tone={c.employeesWithUnknownDays > 0 ? 'error' : undefined} icon={CircleAlert} hint="Employees with at least one unknown day" />
            <StatCard label="Calendar conflicts" value={c.employeesWithConflicts.toLocaleString()} tone={c.employeesWithConflicts > 0 ? 'warning' : undefined} icon={TriangleAlert} hint="Employees with conflicting settings" />
          </div>
          {c.leaveIntegration === 'NOT_AVAILABLE' ? (
            <Notice tone="warning" title="Approved leave is not connected yet">
              The HRMS has no leave-approval module, so no day is ever treated as approved leave. A scheduled workday without attendance stays
              “needs review” — it is never treated as an absence or a deduction automatically.
            </Notice>
          ) : null}
          {c.sample.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-foreground">Employees needing a calendar {c.sampleTruncated ? `(first ${c.sample.length})` : ''}</h2>
              <DataTable
                columns={[
                  { key: 'emp', header: 'Employee', render: (r) => `${r.name} (${r.employeeCode})` },
                  { key: 'unknown', header: 'Days without calendar', render: (r) => r.unknownDays },
                  { key: 'conflicts', header: 'Conflicts', render: (r) => (r.conflicts.length ? r.conflicts.map((x) => CALENDAR_NOTE_LABELS[x] ?? x).join(', ') : '—') },
                  {
                    key: 'open',
                    header: '',
                    className: 'text-right',
                    render: (r) => (
                      <Button variant="outline" size="sm" onClick={() => setEmployee({ id: r.employeeId, label: `${r.name} (${r.employeeCode})` })}>
                        Preview
                      </Button>
                    ),
                  },
                ]}
                data={c.sample}
                getRowId={(r) => r.employeeId}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-foreground">Employee month preview</h2>
            {canSearch ? <EmployeePicker value={employee} onChange={setEmployee} /> : <p className="text-sm text-muted-foreground">Open an employee from the list above.</p>}
          </div>
          {employee && canManage ? (
            <Button
              variant="outline"
              onClick={() => {
                add.reset();
                setForm({ date: '', dayType: 'REST_DAY', reason: '' });
                setOverrideOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Employee day exception
            </Button>
          ) : null}
        </div>
        {preview.isLoading ? <Spinner /> : null}
        {preview.isError ? <ErrorAlert message={err(preview.error, 'Could not load the preview.') ?? ''} /> : null}
        {preview.data ? (
          <CalendarMonthGrid
            days={preview.data.days.map((d) => ({
              date: d.date,
              classification: d.resolution.classification,
              flagged: d.resolution.conflicts.length > 0,
              detail:
                d.resolution.conflicts.length > 0
                  ? CALENDAR_NOTE_LABELS[d.resolution.conflicts[0] as string]
                  : d.resolution.holiday
                    ? d.resolution.holiday.name
                    : d.resolution.classification === 'SCHEDULED_WORKDAY'
                      ? d.resolution.scheduledMinutes !== null
                        ? formatMinutes(d.resolution.scheduledMinutes)
                        : 'Shift unknown'
                      : d.resolution.calendar?.code,
            }))}
          />
        ) : null}
        {employee ? (
          <DataTable
            columns={[
              { key: 'date', header: 'Date', render: (o: DayOverride) => formatWorkDate(o.date) },
              { key: 'type', header: 'Day becomes', render: (o: DayOverride) => (o.dayType === 'WORKING_DAY' ? 'Working day' : 'Rest day') },
              { key: 'reason', header: 'Reason', render: (o: DayOverride) => o.reason },
              { key: 'status', header: 'Status', render: (o: DayOverride) => <PolicyStatusBadge status={o.status} /> },
              {
                key: 'actions',
                header: '',
                className: 'text-right',
                render: (o: DayOverride) =>
                  canActivate && o.status !== 'INACTIVE' ? (
                    <div className="flex justify-end gap-2">
                      {o.status === 'DRAFT' ? (
                        <Button size="sm" onClick={() => setApproving(o)}>
                          Approve
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" onClick={() => setDeactivating(o)}>
                        Deactivate
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
            data={overrides.data ?? []}
            getRowId={(o) => o.id}
            isLoading={overrides.isLoading}
            emptyMessage="No employee-specific day exceptions."
          />
        ) : null}
      </div>

      <FormModal open={overrideOpen} title={`Day exception for ${employee?.label ?? ''} (draft)`} onClose={() => setOverrideOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <FormField label="Date" htmlFor="eo-date" required>
            <Input id="eo-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </FormField>
          <FormField label="The day becomes" htmlFor="eo-type" required>
            <Select id="eo-type" value={form.dayType} onChange={(e) => setForm({ ...form, dayType: e.target.value as CalendarDayType })}>
              <option value="REST_DAY">Rest day</option>
              <option value="WORKING_DAY">Working day</option>
            </Select>
          </FormField>
          <FormField label="Reason" htmlFor="eo-reason" required>
            <Input id="eo-reason" maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </FormField>
          {add.isError ? <ErrorAlert message={err(add.error, 'Could not save.') ?? ''} /> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={add.isPending || !form.date || !form.reason.trim()}>
              {add.isPending ? <Spinner /> : null} Save draft
            </Button>
          </div>
        </form>
      </FormModal>
      <ApprovalDialog
        key={approving?.id ?? 'closed'}
        open={approving !== null}
        title="Approve employee day exception"
        description={approving ? `${formatWorkDate(approving.date)} becomes a ${approving.dayType === 'WORKING_DAY' ? 'working day' : 'rest day'}: ${approving.reason}` : ''}
        isLoading={approve.isPending}
        error={approve.isError ? err(approve.error, 'Could not approve.') : null}
        onConfirm={(ref) => approve.mutate(ref)}
        onCancel={() => setApproving(null)}
      />
      <ReasonDialog
        key={deactivating?.id ?? 'closed-deactivate'}
        open={deactivating !== null}
        title="Deactivate day exception?"
        description="The day returns to the employee's normal calendar. History is kept. Not allowed inside a locked payroll period."
        confirmLabel="Deactivate"
        isLoading={deactivate.isPending}
        error={deactivate.isError ? (err(deactivate.error, 'Could not deactivate.') ?? undefined) : undefined}
        onConfirm={(reason) => deactivate.mutate(reason)}
        onCancel={() => setDeactivating(null)}
      />
    </div>
  );
}
