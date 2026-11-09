'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, Pencil, Plus } from 'lucide-react';
import { AccessDenied } from '@/components/admin/access-denied';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { ReasonDialog } from '@/components/admin/reason-dialog';
import { Spinner } from '@/components/admin/spinner';
import { SuccessBanner } from '@/components/admin/success-banner';
import { MonthPicker, Notice } from '@/components/payroll/payroll-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApprovalDialog, CalendarMonthGrid, EmployeePicker, PolicyStatusBadge, WeekdayChips } from '@/components/work-calendars/calendar-ui';
import { listWorkLocations } from '@/lib/api/work-locations';
import {
  activateDayOverride,
  activateWorkCalendar,
  createCalendarAssignment,
  createDayOverride,
  createWorkCalendar,
  deactivateDayOverride,
  endCalendarAssignment,
  listCalendarAssignments,
  listDayOverrides,
  listShiftOptions,
  listWorkCalendars,
  previewWorkCalendar,
  updateWorkCalendar,
  type CalendarAssignment,
  type CalendarDayType,
  type DayOverride,
  type WorkCalendar,
} from '@/lib/api/work-calendars';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';
import { currentKuwaitMonth, formatWorkDate, WEEKDAY_LABELS } from '@/lib/payroll-attendance/display';
import { describeApiError } from '@/lib/payroll-attendance/errors';

type Approval = { kind: 'calendar'; id: string; label: string } | { kind: 'override'; id: string; label: string };

function WeekdayCheckboxes({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-foreground">Working days (unticked = rest day)</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {WEEKDAY_LABELS.map((label, index) => (
          <label key={label} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={value.includes(index)}
              onChange={(e) => onChange(e.target.checked ? [...value, index].sort() : value.filter((d) => d !== index))}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function WorkCalendarsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canRead = hasPermission(user, 'workCalendars.read');
  const canManage = hasPermission(user, 'workCalendars.manage');
  const canActivate = hasPermission(user, 'workCalendars.activate');

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [month, setMonth] = React.useState(currentKuwaitMonth());
  const [success, setSuccess] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<{ mode: 'create' | 'edit'; calendar?: WorkCalendar } | null>(null);
  const [form, setForm] = React.useState({ code: '', name: '', description: '', workingWeekdays: [] as number[] });
  const [approval, setApproval] = React.useState<Approval | null>(null);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignForm, setAssignForm] = React.useState({ target: 'EMPLOYEE' as 'EMPLOYEE' | 'LOCATION' | 'SHIFT', workLocationId: '', shiftId: '', effectiveFrom: '', effectiveTo: '', reason: '' });
  const [assignEmployee, setAssignEmployee] = React.useState<{ id: string; label: string } | null>(null);
  const [ending, setEnding] = React.useState<CalendarAssignment | null>(null);
  const [endForm, setEndForm] = React.useState({ effectiveTo: '', reason: '' });
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [overrideForm, setOverrideForm] = React.useState({ date: '', dayType: 'REST_DAY' as CalendarDayType, reason: '' });
  const [deactivating, setDeactivating] = React.useState<DayOverride | null>(null);
  const [assignView, setAssignView] = React.useState<'current' | 'all'>('current');

  const calendarsQuery = useQuery({ queryKey: ['work-calendars'], queryFn: ({ signal }) => listWorkCalendars(signal), enabled: canRead });
  const selected = calendarsQuery.data?.find((c) => c.id === selectedId) ?? null;
  const previewQuery = useQuery({
    queryKey: ['work-calendars', 'preview', selectedId, month],
    queryFn: ({ signal }) => previewWorkCalendar(selectedId as string, month, signal),
    enabled: canRead && selectedId !== null,
  });
  const assignmentsQuery = useQuery({
    queryKey: ['work-calendars', 'assignments', selectedId, assignView],
    queryFn: ({ signal }) => listCalendarAssignments({ calendarId: selectedId as string, view: assignView, limit: 100 }, signal),
    enabled: canRead && selected?.status === 'ACTIVE',
  });
  const overridesQuery = useQuery({
    queryKey: ['work-calendars', 'overrides', selectedId],
    queryFn: ({ signal }) => listDayOverrides({ calendarId: selectedId as string }, signal),
    enabled: canRead && selectedId !== null,
  });
  const locationsQuery = useQuery({ queryKey: ['work-locations', 'active-for-dropdown'], queryFn: () => listWorkLocations({ isActive: true, limit: 100 }), enabled: assignOpen && hasPermission(user, 'workLocations.read') });
  const shiftsQuery = useQuery({ queryKey: ['work-calendars', 'shift-options'], queryFn: ({ signal }) => listShiftOptions(signal), enabled: assignOpen });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['work-calendars'] });
  const done = (message: string) => {
    refresh();
    setSuccess(message);
  };

  const saveCalendar = useMutation({
    mutationFn: () =>
      editor?.mode === 'edit' && editor.calendar
        ? updateWorkCalendar(editor.calendar.id, { name: form.name, description: form.description, workingWeekdays: form.workingWeekdays })
        : createWorkCalendar({ code: form.code.trim().toUpperCase(), name: form.name, description: form.description || undefined, workingWeekdays: form.workingWeekdays }),
    onSuccess: (calendar) => {
      setEditor(null);
      setSelectedId(calendar.id);
      done(`Calendar ${calendar.code} saved as a draft. It has no effect until it is approved and assigned.`);
    },
  });
  const approve = useMutation({
    mutationFn: async ({ target, ref }: { target: Approval; ref: string }): Promise<void> => {
      if (target.kind === 'calendar') await activateWorkCalendar(target.id, ref);
      else await activateDayOverride(target.id, ref);
    },
    onSuccess: (_r, { target }) => {
      setApproval(null);
      done(`${target.label} approved and active.`);
    },
  });
  const assign = useMutation({
    mutationFn: () =>
      createCalendarAssignment({
        calendarId: selectedId as string,
        scope: assignForm.target === 'SHIFT' ? 'SHIFT' : 'EMPLOYEE',
        employeeId: assignForm.target === 'EMPLOYEE' ? assignEmployee?.id : undefined,
        workLocationId: assignForm.target === 'LOCATION' ? assignForm.workLocationId : undefined,
        shiftId: assignForm.target === 'SHIFT' ? assignForm.shiftId : undefined,
        effectiveFrom: assignForm.effectiveFrom,
        effectiveTo: assignForm.effectiveTo || undefined,
        reason: assignForm.reason || undefined,
      }),
    onSuccess: (r) => {
      setAssignOpen(false);
      done(`Calendar assigned (${r.created} assignment${r.created === 1 ? '' : 's'} created).`);
    },
  });
  const endAssignment = useMutation({
    mutationFn: () => endCalendarAssignment((ending as CalendarAssignment).id, endForm.effectiveTo, endForm.reason),
    onSuccess: () => {
      setEnding(null);
      done('Assignment ended. Its history is kept.');
    },
  });
  const addOverride = useMutation({
    mutationFn: () => createDayOverride({ calendarId: selectedId as string, date: overrideForm.date, dayType: overrideForm.dayType, reason: overrideForm.reason }),
    onSuccess: () => {
      setOverrideOpen(false);
      done('Day exception saved as a draft. It has no effect until approved.');
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

  const columns: DataTableColumn<WorkCalendar>[] = [
    {
      key: 'name',
      header: 'Calendar',
      render: (c) => (
        <span className="flex flex-col">
          <span className="font-medium">{c.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
        </span>
      ),
    },
    { key: 'days', header: 'Weekly pattern', render: (c) => <WeekdayChips workingWeekdays={c.workingWeekdays} /> },
    { key: 'status', header: 'Status', render: (c) => <PolicyStatusBadge status={c.status} /> },
    {
      key: 'assigned',
      header: 'In use today',
      render: (c) => `${c.currentAssignments?.employees ?? 0} employee(s) · ${c.currentAssignments?.shifts ?? 0} shift(s)`,
    },
    {
      key: 'open',
      header: '',
      className: 'text-right',
      render: (c) => (
        <Button variant={c.id === selectedId ? 'default' : 'outline'} size="sm" onClick={() => setSelectedId(c.id)}>
          {c.id === selectedId ? 'Selected' : 'Open'}
        </Button>
      ),
    },
  ];

  const err = (e: unknown, f: string) => describeApiError(e, f);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Working Calendars</h1>
          <p className="text-base text-muted-foreground">Weekly working days and rest days. Used by monthly attendance and payroll closing only after HR approval.</p>
        </div>
        {canManage ? (
          <Button
            size="lg"
            onClick={() => {
              saveCalendar.reset();
              setForm({ code: '', name: '', description: '', workingWeekdays: [] });
              setEditor({ mode: 'create' });
            }}
          >
            <CalendarPlus className="h-4 w-4" /> New calendar
          </Button>
        ) : null}
      </div>

      <Notice tone="info" title="How calendars take effect">
        New calendars and day exceptions start as <strong>Draft</strong> and change nothing. They take effect only after approval (with an HR approval
        reference) and assignment to employees or shifts. Approved calendars cannot be edited — create a new one and re-assign from an effective date, so
        past months never change. Dates inside a locked payroll period cannot be changed. No weekend is assumed for anyone.
      </Notice>

      {success ? <SuccessBanner message={success} onDismiss={() => setSuccess(null)} /> : null}
      {calendarsQuery.isError ? <ErrorAlert message={err(calendarsQuery.error, 'Could not load calendars.') ?? ''} /> : null}

      <DataTable columns={columns} data={calendarsQuery.data ?? []} getRowId={(c) => c.id} isLoading={calendarsQuery.isLoading} emptyMessage="No working calendars yet." />

      {selected ? (
        <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold text-foreground">
                {selected.name} <span className="font-mono text-sm text-muted-foreground">{selected.code}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <PolicyStatusBadge status={selected.status} />
                <WeekdayChips workingWeekdays={selected.workingWeekdays} />
              </div>
              {selected.description ? <p className="text-sm text-muted-foreground">{selected.description}</p> : null}
              {selected.approvalReference ? <p className="text-sm text-muted-foreground">Approval reference: {selected.approvalReference}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage && selected.status === 'DRAFT' ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    saveCalendar.reset();
                    setForm({ code: selected.code, name: selected.name, description: selected.description ?? '', workingWeekdays: selected.workingWeekdays });
                    setEditor({ mode: 'edit', calendar: selected });
                  }}
                >
                  <Pencil className="h-4 w-4" /> Edit draft
                </Button>
              ) : null}
              {canActivate && selected.status === 'DRAFT' ? (
                <Button
                  onClick={() => {
                    approve.reset();
                    setApproval({ kind: 'calendar', id: selected.id, label: `Calendar ${selected.code}` });
                  }}
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve calendar
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">Preview {previewQuery.data?.isDraft ? '(draft — not in use)' : ''}</h3>
              <MonthPicker id="calendar-preview-month" value={month} onChange={setMonth} />
            </div>
            {previewQuery.isLoading ? <Spinner /> : null}
            {previewQuery.data ? (
              <CalendarMonthGrid
                days={previewQuery.data.days.map((d) => ({
                  date: d.date,
                  classification: d.classification,
                  detail: d.holiday ? d.holiday.name : d.overrideId ? 'Day exception' : undefined,
                }))}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">Shows approved public holidays and approved day exceptions of this calendar. Employee-specific exceptions are on Calendar Coverage.</p>
          </div>

          {selected.status === 'ACTIVE' ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-foreground">Assigned to</h3>
                <div className="flex gap-2">
                  <Select value={assignView} onChange={(e) => setAssignView(e.target.value as 'current' | 'all')} className="w-48">
                    <option value="current">Current and future</option>
                    <option value="all">All, including ended</option>
                  </Select>
                  {canActivate ? (
                    <Button
                      onClick={() => {
                        assign.reset();
                        setAssignEmployee(null);
                        setAssignForm({ target: 'EMPLOYEE', workLocationId: '', shiftId: '', effectiveFrom: '', effectiveTo: '', reason: '' });
                        setAssignOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4" /> Assign
                    </Button>
                  ) : null}
                </div>
              </div>
              <DataTable
                columns={[
                  {
                    key: 'who',
                    header: 'Employee / shift',
                    render: (a: CalendarAssignment) =>
                      a.employee ? `${a.employee.firstName} ${a.employee.lastName} (${a.employee.employeeCode})` : `Shift: ${a.shift?.name ?? '—'}`,
                  },
                  { key: 'from', header: 'From', render: (a: CalendarAssignment) => formatWorkDate(a.effectiveFrom) },
                  { key: 'to', header: 'To', render: (a: CalendarAssignment) => (a.effectiveTo ? formatWorkDate(a.effectiveTo) : 'Open-ended') },
                  { key: 'reason', header: 'Reason', render: (a: CalendarAssignment) => a.reason ?? '—' },
                  {
                    key: 'end',
                    header: '',
                    className: 'text-right',
                    render: (a: CalendarAssignment) =>
                      canActivate ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            endAssignment.reset();
                            setEndForm({ effectiveTo: '', reason: '' });
                            setEnding(a);
                          }}
                        >
                          End
                        </Button>
                      ) : null,
                  },
                ]}
                data={assignmentsQuery.data?.data ?? []}
                getRowId={(a) => a.id}
                isLoading={assignmentsQuery.isLoading}
                emptyMessage="Not assigned to anyone yet."
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">A calendar can be assigned once it is approved.</p>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">Day exceptions for everyone on this calendar</h3>
              {canManage ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    addOverride.reset();
                    setOverrideForm({ date: '', dayType: 'REST_DAY', reason: '' });
                    setOverrideOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" /> Add special day
                </Button>
              ) : null}
            </div>
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
                          <Button size="sm" onClick={() => setApproval({ kind: 'override', id: o.id, label: `Special day ${formatWorkDate(o.date)}` })}>
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
              data={overridesQuery.data ?? []}
              getRowId={(o) => o.id}
              isLoading={overridesQuery.isLoading}
              emptyMessage="No special days."
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Open a calendar to preview it, approve it, assign it, or add special days.</p>
      )}

      {/* Create / edit draft */}
      <FormModal open={editor !== null} title={editor?.mode === 'edit' ? 'Edit draft calendar' : 'New working calendar (draft)'} onClose={() => setEditor(null)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveCalendar.mutate();
          }}
        >
          {editor?.mode === 'create' ? (
            <FormField label="Code (capital letters, digits, - or _)" htmlFor="cal-code" required>
              <Input id="cal-code" value={form.code} maxLength={40} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. HQ-SUN-THU" />
            </FormField>
          ) : null}
          <FormField label="Name" htmlFor="cal-name" required>
            <Input id="cal-name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <WeekdayCheckboxes value={form.workingWeekdays} onChange={(workingWeekdays) => setForm({ ...form, workingWeekdays })} />
          <FormField label="Description (optional)" htmlFor="cal-desc">
            <Textarea id="cal-desc" rows={2} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </FormField>
          {saveCalendar.isError ? <ErrorAlert message={err(saveCalendar.error, 'Could not save the calendar.') ?? ''} /> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={saveCalendar.isPending || !form.name.trim() || (editor?.mode === 'create' && !form.code.trim())}>
              {saveCalendar.isPending ? <Spinner /> : null} Save draft
            </Button>
          </div>
        </form>
      </FormModal>

      {/* Assign */}
      <FormModal open={assignOpen} title={`Assign ${selected?.code ?? ''}`} onClose={() => setAssignOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            assign.mutate();
          }}
        >
          <FormField label="Assign to" htmlFor="assign-target" required>
            <Select id="assign-target" value={assignForm.target} onChange={(e) => setAssignForm({ ...assignForm, target: e.target.value as 'EMPLOYEE' | 'LOCATION' | 'SHIFT' })}>
              <option value="EMPLOYEE">One employee</option>
              <option value="LOCATION">All employees currently at a work location</option>
              <option value="SHIFT">Everyone on a shift</option>
            </Select>
          </FormField>
          {assignForm.target === 'EMPLOYEE' ? <EmployeePicker value={assignEmployee} onChange={setAssignEmployee} /> : null}
          {assignForm.target === 'LOCATION' ? (
            <FormField label="Work location" htmlFor="assign-location" required>
              <Select id="assign-location" value={assignForm.workLocationId} onChange={(e) => setAssignForm({ ...assignForm, workLocationId: e.target.value })}>
                <option value="">— Select —</option>
                {(locationsQuery.data?.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {assignForm.target === 'SHIFT' ? (
            <FormField label="Shift" htmlFor="assign-shift" required>
              <Select id="assign-shift" value={assignForm.shiftId} onChange={(e) => setAssignForm({ ...assignForm, shiftId: e.target.value })}>
                <option value="">— Select —</option>
                {(shiftsQuery.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {assignForm.target === 'LOCATION' ? (
            <p className="text-sm text-muted-foreground">One dated assignment is created per employee, so later transfers keep the correct history.</p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="From date" htmlFor="assign-from" required>
              <Input id="assign-from" type="date" value={assignForm.effectiveFrom} onChange={(e) => setAssignForm({ ...assignForm, effectiveFrom: e.target.value })} />
            </FormField>
            <FormField label="To date (optional)" htmlFor="assign-to">
              <Input id="assign-to" type="date" value={assignForm.effectiveTo} onChange={(e) => setAssignForm({ ...assignForm, effectiveTo: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Reason (optional)" htmlFor="assign-reason">
            <Input id="assign-reason" maxLength={500} value={assignForm.reason} onChange={(e) => setAssignForm({ ...assignForm, reason: e.target.value })} />
          </FormField>
          {assign.isError ? <ErrorAlert message={err(assign.error, 'Could not assign the calendar.') ?? ''} /> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={
                assign.isPending ||
                !assignForm.effectiveFrom ||
                (assignForm.target === 'EMPLOYEE' && !assignEmployee) ||
                (assignForm.target === 'LOCATION' && !assignForm.workLocationId) ||
                (assignForm.target === 'SHIFT' && !assignForm.shiftId)
              }
            >
              {assign.isPending ? <Spinner /> : null} Assign
            </Button>
          </div>
        </form>
      </FormModal>

      {/* End assignment */}
      <FormModal open={ending !== null} title="End assignment" onClose={() => setEnding(null)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            endAssignment.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">The assignment stays in the history. Days after the last day will need another calendar.</p>
          <FormField label="Last day the calendar applies" htmlFor="end-to" required>
            <Input id="end-to" type="date" value={endForm.effectiveTo} onChange={(e) => setEndForm({ ...endForm, effectiveTo: e.target.value })} />
          </FormField>
          <FormField label="Reason" htmlFor="end-reason" required>
            <Input id="end-reason" maxLength={500} value={endForm.reason} onChange={(e) => setEndForm({ ...endForm, reason: e.target.value })} />
          </FormField>
          {endAssignment.isError ? <ErrorAlert message={err(endAssignment.error, 'Could not end the assignment.') ?? ''} /> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setEnding(null)}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={endAssignment.isPending || !endForm.effectiveTo || !endForm.reason.trim()}>
              {endAssignment.isPending ? <Spinner /> : null} End assignment
            </Button>
          </div>
        </form>
      </FormModal>

      {/* Calendar day exception */}
      <FormModal open={overrideOpen} title="Special day for this calendar (draft)" onClose={() => setOverrideOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            addOverride.mutate();
          }}
        >
          <FormField label="Date" htmlFor="ov-date" required>
            <Input id="ov-date" type="date" value={overrideForm.date} onChange={(e) => setOverrideForm({ ...overrideForm, date: e.target.value })} />
          </FormField>
          <FormField label="The day becomes" htmlFor="ov-type" required>
            <Select id="ov-type" value={overrideForm.dayType} onChange={(e) => setOverrideForm({ ...overrideForm, dayType: e.target.value as CalendarDayType })}>
              <option value="REST_DAY">Rest day</option>
              <option value="WORKING_DAY">Working day</option>
            </Select>
          </FormField>
          <FormField label="Reason" htmlFor="ov-reason" required>
            <Input id="ov-reason" maxLength={500} value={overrideForm.reason} onChange={(e) => setOverrideForm({ ...overrideForm, reason: e.target.value })} />
          </FormField>
          {addOverride.isError ? <ErrorAlert message={err(addOverride.error, 'Could not save the special day.') ?? ''} /> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={addOverride.isPending || !overrideForm.date || !overrideForm.reason.trim()}>
              {addOverride.isPending ? <Spinner /> : null} Save draft
            </Button>
          </div>
        </form>
      </FormModal>

      <ApprovalDialog
        key={approval?.id ?? 'closed'}
        open={approval !== null}
        title={`Approve ${approval?.label ?? ''}`}
        description="Approval makes this take effect for attendance and payroll closing. It is recorded with your name and the reference below."
        isLoading={approve.isPending}
        error={approve.isError ? err(approve.error, 'Could not approve.') : null}
        onConfirm={(ref) => approval && approve.mutate({ target: approval, ref })}
        onCancel={() => setApproval(null)}
      />
      <ReasonDialog
        key={deactivating?.id ?? 'closed-deactivate'}
        open={deactivating !== null}
        title="Deactivate special day?"
        description="The day returns to the calendar's normal pattern. History is kept. Not allowed inside a locked payroll period."
        confirmLabel="Deactivate"
        isLoading={deactivate.isPending}
        error={deactivate.isError ? (err(deactivate.error, 'Could not deactivate.') ?? undefined) : undefined}
        onConfirm={(reason) => deactivate.mutate(reason)}
        onCancel={() => setDeactivating(null)}
      />
    </div>
  );
}
