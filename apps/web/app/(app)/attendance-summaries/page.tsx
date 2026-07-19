'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Lock, RefreshCw } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AccessDenied } from '@/components/admin/access-denied';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { DetailRow } from '@/components/admin/detail-row';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { PaginationControls } from '@/components/admin/pagination-controls';
import { Spinner } from '@/components/admin/spinner';
import { SuccessBanner } from '@/components/admin/success-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import {
  DAILY_ATTENDANCE_STATUSES,
  calculateAttendanceSummary,
  listAttendanceSummaries,
  recalculateAttendanceSummaryRange,
  type AttendanceDailySummary,
  type DailyAttendanceStatus,
} from '@/lib/api/attendance-summaries';
import { ApiError } from '@/lib/api/client';
import { listDepartments } from '@/lib/api/departments';
import { listEmployees } from '@/lib/api/employees';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const STATUS_LABELS: Record<DailyAttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  HALF_DAY: 'Half Day',
  LEAVE: 'Leave',
  WEEK_OFF: 'Week Off',
  HOLIDAY: 'Holiday',
  MISSING_PUNCH: 'Missing Punch',
};

// Matches context/ui-context.md's attendance badge conventions.
const STATUS_TONES: Record<DailyAttendanceStatus, BadgeTone> = {
  PRESENT: 'success',
  ABSENT: 'error',
  LATE: 'warning',
  HALF_DAY: 'warning',
  LEAVE: 'info',
  WEEK_OFF: 'muted',
  HOLIDAY: 'muted',
  MISSING_PUNCH: 'warning',
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

const optionalString = (max: number) => z.string().max(max).optional().or(z.literal(''));

const calculateSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  workDate: z.string().min(1, 'Work date is required'),
});
type CalculateFormValues = z.infer<typeof calculateSchema>;

const recalculateRangeSchema = z.object({
  employeeId: optionalString(100),
  from: z.string().min(1, 'From date is required'),
  to: z.string().min(1, 'To date is required'),
  limit: z.number().int().min(1).max(100).optional(),
});
type RecalculateRangeFormValues = z.infer<typeof recalculateRangeSchema>;

export default function AttendanceSummariesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'attendanceSummaries.read');
  const canCalculate = hasPermission(user, 'attendanceSummaries.calculate');
  const canRecalculate = hasPermission(user, 'attendanceSummaries.recalculate');

  const [page, setPage] = React.useState(1);
  const [employeeIdFilter, setEmployeeIdFilter] = React.useState('');
  const [departmentFilter, setDepartmentFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [fromFilter, setFromFilter] = React.useState('');
  const [toFilter, setToFilter] = React.useState('');

  const [viewSummary, setViewSummary] = React.useState<AttendanceDailySummary | null>(null);
  const [calculateOpen, setCalculateOpen] = React.useState(false);
  const [recalculateOpen, setRecalculateOpen] = React.useState(false);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['attendance-summaries', { page, employeeIdFilter, departmentFilter, statusFilter, fromFilter, toFilter }],
    queryFn: () =>
      listAttendanceSummaries({
        page,
        limit: 20,
        employeeId: employeeIdFilter || undefined,
        departmentId: departmentFilter || undefined,
        status: (statusFilter || undefined) as DailyAttendanceStatus | undefined,
        from: fromFilter || undefined,
        to: toFilter || undefined,
      }),
    enabled: canRead,
    placeholderData: (previous) => previous,
  });

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active-for-dropdown'],
    queryFn: () => listDepartments({ isActive: true, limit: 100 }),
    enabled: canRead,
  });
  const employeesQuery = useQuery({
    queryKey: ['employees', 'active-for-dropdown'],
    queryFn: () => listEmployees({ limit: 100 }),
    enabled: canCalculate || canRecalculate,
  });

  const calculateForm = useForm<CalculateFormValues>({
    resolver: zodResolver(calculateSchema),
    defaultValues: { employeeId: '', workDate: '' },
  });
  const calculateMutation = useMutation({
    mutationFn: (values: CalculateFormValues) => calculateAttendanceSummary(values.employeeId, values.workDate),
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-summaries'] });
      setSuccessMessage(`Summary calculated: ${formatDate(summary.workDate)} — ${STATUS_LABELS[summary.status]}.`);
      setCalculateOpen(false);
      calculateForm.reset();
    },
  });

  const recalculateForm = useForm<RecalculateRangeFormValues>({
    resolver: zodResolver(recalculateRangeSchema),
    defaultValues: { employeeId: '', from: '', to: '', limit: 20 },
  });
  const recalculateMutation = useMutation({
    mutationFn: (values: RecalculateRangeFormValues) =>
      recalculateAttendanceSummaryRange({
        employeeId: values.employeeId || undefined,
        from: values.from,
        to: values.to,
        limit: values.limit,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-summaries'] });
      setSuccessMessage(
        `Recalculated ${result.calculated} of ${result.totalCandidateDays} candidate day(s); ${result.skippedLocked} skipped (locked); ${result.failed} failed.`,
      );
      setRecalculateOpen(false);
      recalculateForm.reset();
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const columns: DataTableColumn<AttendanceDailySummary>[] = [
    {
      key: 'employee',
      header: 'Employee',
      render: (row) =>
        row.employee ? `${row.employee.firstName} ${row.employee.lastName} (${row.employee.employeeCode})` : row.employeeId,
    },
    { key: 'workDate', header: 'Work Date', render: (row) => formatDate(row.workDate) },
    { key: 'officialInTime', header: 'Official IN', render: (row) => formatDateTime(row.officialInTime) },
    { key: 'officialOutTime', header: 'Official OUT', render: (row) => formatDateTime(row.officialOutTime) },
    { key: 'totalWorkedMinutes', header: 'Worked', render: (row) => formatMinutes(row.totalWorkedMinutes) },
    { key: 'lateMinutes', header: 'Late', render: (row) => `${row.lateMinutes}m` },
    { key: 'overtimeMinutes', header: 'Overtime', render: (row) => `${row.overtimeMinutes}m` },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge label={STATUS_LABELS[row.status]} tone={STATUS_TONES[row.status]} />
          {row.lockedAt ? <StatusBadge label="Locked" tone="locked" /> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <Button variant="outline" size="sm" onClick={() => setViewSummary(row)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Attendance Summaries</h1>
          <p className="text-sm text-muted-foreground">Derived daily official IN/OUT, worked hours, and status.</p>
        </div>
        <div className="flex gap-2">
          {canRecalculate ? (
            <Button variant="outline" onClick={() => setRecalculateOpen(true)}>
              <RefreshCw className="h-4 w-4" />
              Recalculate Range
            </Button>
          ) : null}
          {canCalculate ? (
            <Button onClick={() => setCalculateOpen(true)}>
              <Calculator className="h-4 w-4" />
              Calculate Summary
            </Button>
          ) : null}
        </div>
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {listQuery.isError ? <ErrorAlert message={errorMessage(listQuery.error, 'Failed to load attendance summaries.')} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={employeeIdFilter}
          onChange={(event) => {
            setEmployeeIdFilter(event.target.value);
            setPage(1);
          }}
          placeholder="Employee ID…"
          className="w-48"
        />
        <Select
          value={departmentFilter}
          onChange={(event) => {
            setDepartmentFilter(event.target.value);
            setPage(1);
          }}
          className="w-48"
        >
          <option value="">All departments</option>
          {(departmentsQuery.data?.data ?? []).map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
          }}
          className="w-44"
        >
          <option value="">All statuses</option>
          {DAILY_ATTENDANCE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
        <DateRangeFilter
          from={fromFilter}
          to={toFilter}
          onFromChange={(value) => {
            setFromFilter(value);
            setPage(1);
          }}
          onToChange={(value) => {
            setToFilter(value);
            setPage(1);
          }}
        />
      </div>

      <DataTable
        columns={columns}
        data={listQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        isLoading={listQuery.isLoading}
        emptyMessage="No attendance summaries found."
      />

      {listQuery.data ? (
        <PaginationControls
          page={listQuery.data.meta.page}
          totalPages={listQuery.data.meta.totalPages}
          total={listQuery.data.meta.total}
          onPageChange={setPage}
        />
      ) : null}

      <FormModal open={viewSummary !== null} title="Attendance Summary Details" onClose={() => setViewSummary(null)}>
        {viewSummary ? (
          <div className="flex flex-col">
            <DetailRow
              label="Employee"
              value={
                viewSummary.employee
                  ? `${viewSummary.employee.firstName} ${viewSummary.employee.lastName} (${viewSummary.employee.employeeCode})`
                  : viewSummary.employeeId
              }
            />
            <DetailRow label="Work Date" value={formatDate(viewSummary.workDate)} />
            <DetailRow
              label="Status"
              value={<StatusBadge label={STATUS_LABELS[viewSummary.status]} tone={STATUS_TONES[viewSummary.status]} />}
            />
            {viewSummary.lockedAt ? (
              <DetailRow
                label="Locked"
                value={
                  <span className="inline-flex items-center gap-1">
                    <Lock className="h-3.5 w-3.5" /> {formatDateTime(viewSummary.lockedAt)}
                  </span>
                }
              />
            ) : null}
            <DetailRow label="Official IN" value={formatDateTime(viewSummary.officialInTime)} />
            <DetailRow label="Official OUT" value={formatDateTime(viewSummary.officialOutTime)} />
            <DetailRow
              label="Official IN Source"
              value={viewSummary.officialInPunch?.sourceType ?? '—'}
            />
            <DetailRow
              label="Official OUT Source"
              value={viewSummary.officialOutPunch?.sourceType ?? '—'}
            />
            <DetailRow label="Total Worked" value={formatMinutes(viewSummary.totalWorkedMinutes)} />
            <DetailRow label="Late" value={`${viewSummary.lateMinutes}m`} />
            <DetailRow label="Early Leave" value={`${viewSummary.earlyLeaveMinutes}m`} />
            <DetailRow label="Overtime" value={`${viewSummary.overtimeMinutes}m`} />
            <DetailRow label="Calculation Version" value={viewSummary.calculationVersion} />
            <DetailRow label="Calculated At" value={formatDateTime(viewSummary.calculatedAt)} />
          </div>
        ) : null}
      </FormModal>

      <FormModal open={calculateOpen} title="Calculate Attendance Summary" onClose={() => setCalculateOpen(false)}>
        <form
          onSubmit={calculateForm.handleSubmit((values) => calculateMutation.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormField
            label="Employee"
            htmlFor="calc-employee"
            required
            error={calculateForm.formState.errors.employeeId?.message}
          >
            <Select id="calc-employee" {...calculateForm.register('employeeId')}>
              <option value="">— Select —</option>
              {(employeesQuery.data?.data ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} ({employee.employeeCode})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Work Date"
            htmlFor="calc-work-date"
            required
            error={calculateForm.formState.errors.workDate?.message}
          >
            <Input id="calc-work-date" type="date" {...calculateForm.register('workDate')} />
          </FormField>
          {calculateMutation.isError ? (
            <ErrorAlert message={errorMessage(calculateMutation.error, 'Failed to calculate summary.')} />
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setCalculateOpen(false)} disabled={calculateMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={calculateMutation.isPending}>
              {calculateMutation.isPending ? (
                <>
                  <Spinner /> Calculating…
                </>
              ) : (
                'Calculate'
              )}
            </Button>
          </div>
        </form>
      </FormModal>

      <FormModal open={recalculateOpen} title="Recalculate Summary Range" onClose={() => setRecalculateOpen(false)}>
        <form
          onSubmit={recalculateForm.handleSubmit((values) => recalculateMutation.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <p className="text-sm text-muted-foreground">
            Recalculates summaries for employee/days that already have raw punch activity in this range — locked days
            are skipped, not overwritten.
          </p>
          <FormField label="Employee (optional — all employees if blank)" htmlFor="recalc-employee">
            <Select id="recalc-employee" {...recalculateForm.register('employeeId')}>
              <option value="">— All employees —</option>
              {(employeesQuery.data?.data ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} ({employee.employeeCode})
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="From" htmlFor="recalc-from" required error={recalculateForm.formState.errors.from?.message}>
              <Input id="recalc-from" type="date" {...recalculateForm.register('from')} />
            </FormField>
            <FormField label="To" htmlFor="recalc-to" required error={recalculateForm.formState.errors.to?.message}>
              <Input id="recalc-to" type="date" {...recalculateForm.register('to')} />
            </FormField>
          </div>
          <FormField label="Limit (max 100 employee-days)" htmlFor="recalc-limit">
            <Input
              id="recalc-limit"
              type="number"
              step="1"
              {...recalculateForm.register('limit', {
                setValueAs: (value: string) => (value === '' ? undefined : Number(value)),
              })}
            />
          </FormField>
          {recalculateMutation.isError ? (
            <ErrorAlert message={errorMessage(recalculateMutation.error, 'Failed to recalculate range.')} />
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRecalculateOpen(false)}
              disabled={recalculateMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={recalculateMutation.isPending}>
              {recalculateMutation.isPending ? (
                <>
                  <Spinner /> Running…
                </>
              ) : (
                'Recalculate'
              )}
            </Button>
          </div>
        </form>
      </FormModal>
    </div>
  );
}
