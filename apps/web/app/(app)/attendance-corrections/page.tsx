'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AccessDenied } from '@/components/admin/access-denied';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { DateRangeFilter } from '@/components/admin/date-range-filter';
import { DetailRow } from '@/components/admin/detail-row';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { PaginationControls } from '@/components/admin/pagination-controls';
import { ReasonDialog } from '@/components/admin/reason-dialog';
import { Spinner } from '@/components/admin/spinner';
import { SuccessBanner } from '@/components/admin/success-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import {
  CORRECTION_STATUSES,
  CORRECTION_TYPES,
  adminRequestAttendanceCorrection,
  approveAttendanceCorrection,
  listAttendanceCorrections,
  rejectAttendanceCorrection,
  type AttendanceCorrection,
  type CorrectionStatus,
  type CorrectionType,
} from '@/lib/api/attendance-corrections';
import { PUNCH_TYPES, type PunchType } from '@/lib/api/attendance-punches';
import { ApiError } from '@/lib/api/client';
import { listEmployees } from '@/lib/api/employees';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const STATUS_LABELS: Record<CorrectionStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const STATUS_TONES: Record<CorrectionStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  CANCELLED: 'muted',
};

const TYPE_LABELS: Record<CorrectionType, string> = {
  MISSED_IN: 'Missed IN',
  MISSED_OUT: 'Missed OUT',
  WRONG_IN: 'Wrong IN',
  WRONG_OUT: 'Wrong OUT',
  MANUAL_ADJUSTMENT: 'Manual Adjustment',
  OTHER: 'Other',
};

const TYPES_REQUIRING_PUNCH_TIME: CorrectionType[] = [
  'MISSED_IN',
  'MISSED_OUT',
  'WRONG_IN',
  'WRONG_OUT',
  'MANUAL_ADJUSTMENT',
];
const TYPES_REQUIRING_TARGET_PUNCH: CorrectionType[] = ['WRONG_IN', 'WRONG_OUT'];

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

const adminRequestSchema = z
  .object({
    employeeId: z.string().min(1, 'Employee is required'),
    workDate: z.string().min(1, 'Work date is required'),
    correctionType: z.enum(['MISSED_IN', 'MISSED_OUT', 'WRONG_IN', 'WRONG_OUT', 'MANUAL_ADJUSTMENT', 'OTHER']),
    requestedPunchType: z.enum(['IN', 'OUT', 'BREAK_START', 'BREAK_END']).optional(),
    requestedPunchTime: z.string().optional(),
    targetPunchId: z.string().optional(),
    reason: z.string().min(1, 'Reason is required').max(1000),
  })
  .superRefine((data, ctx) => {
    if (TYPES_REQUIRING_PUNCH_TIME.includes(data.correctionType) && !data.requestedPunchTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Requested punch time is required for this correction type',
        path: ['requestedPunchTime'],
      });
    }
    if (TYPES_REQUIRING_TARGET_PUNCH.includes(data.correctionType) && !data.targetPunchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Target punch ID is required for this correction type',
        path: ['targetPunchId'],
      });
    }
    if (data.correctionType === 'MANUAL_ADJUSTMENT' && !data.requestedPunchType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Requested punch type is required for a manual adjustment',
        path: ['requestedPunchType'],
      });
    }
  });
type AdminRequestFormValues = z.infer<typeof adminRequestSchema>;

export default function AttendanceCorrectionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'attendanceCorrections.read');
  // The backend's real admin-request endpoint requires `.approve`, not `.request` (a Unit 10 security
  // fix — an earlier version gated it on `.request`, which every EMPLOYEE also holds for self-service).
  const canAdminRequest = hasPermission(user, 'attendanceCorrections.approve');
  const canApprove = hasPermission(user, 'attendanceCorrections.approve');
  const canReject = hasPermission(user, 'attendanceCorrections.reject');

  const [page, setPage] = React.useState(1);
  const [employeeIdFilter, setEmployeeIdFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('');
  const [fromFilter, setFromFilter] = React.useState('');
  const [toFilter, setToFilter] = React.useState('');

  const [viewCorrection, setViewCorrection] = React.useState<AttendanceCorrection | null>(null);
  const [requestFormOpen, setRequestFormOpen] = React.useState(false);
  const [approveTarget, setApproveTarget] = React.useState<AttendanceCorrection | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<AttendanceCorrection | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['attendance-corrections', { page, employeeIdFilter, statusFilter, typeFilter, fromFilter, toFilter }],
    queryFn: () =>
      listAttendanceCorrections({
        page,
        limit: 20,
        employeeId: employeeIdFilter || undefined,
        status: (statusFilter || undefined) as CorrectionStatus | undefined,
        correctionType: (typeFilter || undefined) as CorrectionType | undefined,
        from: fromFilter || undefined,
        to: toFilter || undefined,
      }),
    enabled: canRead,
    placeholderData: (previous) => previous,
  });

  const employeesQuery = useQuery({
    queryKey: ['employees', 'active-for-dropdown'],
    queryFn: () => listEmployees({ limit: 100 }),
    enabled: canAdminRequest,
  });

  const requestForm = useForm<AdminRequestFormValues>({
    resolver: zodResolver(adminRequestSchema),
    defaultValues: {
      employeeId: '',
      workDate: '',
      correctionType: 'MISSED_OUT',
      requestedPunchType: 'IN',
      requestedPunchTime: '',
      targetPunchId: '',
      reason: '',
    },
  });
  const [selectedType, setSelectedType] = React.useState<CorrectionType>('MISSED_OUT');

  const requestMutation = useMutation({
    mutationFn: (values: AdminRequestFormValues) => {
      const input: Parameters<typeof adminRequestAttendanceCorrection>[0] = {
        employeeId: values.employeeId,
        workDate: values.workDate,
        correctionType: values.correctionType,
        reason: values.reason,
      };
      if (TYPES_REQUIRING_PUNCH_TIME.includes(values.correctionType) && values.requestedPunchTime) {
        input.requestedPunchTime = new Date(values.requestedPunchTime).toISOString();
      }
      if (TYPES_REQUIRING_TARGET_PUNCH.includes(values.correctionType) && values.targetPunchId) {
        input.targetPunchId = values.targetPunchId;
      }
      if (values.correctionType === 'MANUAL_ADJUSTMENT' && values.requestedPunchType) {
        input.requestedPunchType = values.requestedPunchType as PunchType;
      }
      return adminRequestAttendanceCorrection(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-corrections'] });
      setSuccessMessage('Correction request created (pending approval).');
      setRequestFormOpen(false);
      requestForm.reset();
      setSelectedType('MISSED_OUT');
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveAttendanceCorrection(id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-corrections'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance-punches'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance-summaries'] });
      const detail = result.manualPunchId
        ? ' A manual punch was created and the day’s summary was recalculated.'
        : '';
      setSuccessMessage(`Correction approved.${detail}`);
      setApproveTarget(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectAttendanceCorrection(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-corrections'] });
      setSuccessMessage('Correction rejected.');
      setRejectTarget(null);
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const columns: DataTableColumn<AttendanceCorrection>[] = [
    {
      key: 'employee',
      header: 'Employee',
      render: (row) =>
        row.employee ? `${row.employee.firstName} ${row.employee.lastName} (${row.employee.employeeCode})` : row.employeeId,
    },
    { key: 'workDate', header: 'Work Date', render: (row) => formatDate(row.workDate) },
    { key: 'correctionType', header: 'Type', render: (row) => TYPE_LABELS[row.correctionType] },
    {
      key: 'requestedPunch',
      header: 'Requested Punch',
      render: (row) =>
        row.requestedPunchType && row.requestedPunchTime
          ? `${row.requestedPunchType} @ ${formatDateTime(row.requestedPunchTime)}`
          : '—',
    },
    { key: 'requestedBy', header: 'Requested By', render: (row) => row.requestedBy?.username ?? '—' },
    { key: 'approvedBy', header: 'Approved By', render: (row) => row.approvedBy?.username ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge label={STATUS_LABELS[row.status]} tone={STATUS_TONES[row.status]} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setViewCorrection(row)}>
            View
          </Button>
          {canApprove && row.status === 'PENDING' ? (
            <Button variant="outline" size="sm" onClick={() => setApproveTarget(row)}>
              Approve
            </Button>
          ) : null}
          {canReject && row.status === 'PENDING' ? (
            <Button variant="outline" size="sm" onClick={() => setRejectTarget(row)}>
              Reject
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Attendance Corrections</h1>
          <p className="text-sm text-muted-foreground">Missed-punch and correction requests with approval workflow.</p>
        </div>
        {canAdminRequest ? (
          <Button onClick={() => setRequestFormOpen(true)}>
            <Plus className="h-4 w-4" />
            Request Correction
          </Button>
        ) : null}
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {listQuery.isError ? (
        <ErrorAlert message={errorMessage(listQuery.error, 'Failed to load attendance corrections.')} />
      ) : null}
      {approveMutation.isError ? (
        <ErrorAlert message={errorMessage(approveMutation.error, 'Failed to approve correction.')} />
      ) : null}

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
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
          }}
          className="w-40"
        >
          <option value="">All statuses</option>
          {CORRECTION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
        <Select
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value);
            setPage(1);
          }}
          className="w-44"
        >
          <option value="">All types</option>
          {CORRECTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
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
        emptyMessage="No attendance corrections found."
      />

      {listQuery.data ? (
        <PaginationControls
          page={listQuery.data.meta.page}
          totalPages={listQuery.data.meta.totalPages}
          total={listQuery.data.meta.total}
          onPageChange={setPage}
        />
      ) : null}

      <FormModal open={viewCorrection !== null} title="Correction Details" onClose={() => setViewCorrection(null)}>
        {viewCorrection ? (
          <div className="flex flex-col gap-4">
            <div>
              <DetailRow
                label="Employee"
                value={
                  viewCorrection.employee
                    ? `${viewCorrection.employee.firstName} ${viewCorrection.employee.lastName} (${viewCorrection.employee.employeeCode})`
                    : viewCorrection.employeeId
                }
              />
              <DetailRow label="Work Date" value={formatDate(viewCorrection.workDate)} />
              <DetailRow label="Correction Type" value={TYPE_LABELS[viewCorrection.correctionType]} />
              <DetailRow
                label="Status"
                value={<StatusBadge label={STATUS_LABELS[viewCorrection.status]} tone={STATUS_TONES[viewCorrection.status]} />}
              />
              <DetailRow label="Reason" value={viewCorrection.reason} />
              <DetailRow label="Requested Punch Type" value={viewCorrection.requestedPunchType ?? '—'} />
              <DetailRow label="Requested Punch Time" value={formatDateTime(viewCorrection.requestedPunchTime)} />
              <DetailRow label="Target Punch ID" value={viewCorrection.targetPunchId ?? '—'} />
              <DetailRow label="Requested By" value={viewCorrection.requestedBy?.username ?? '—'} />
              <DetailRow label="Approved By" value={viewCorrection.approvedBy?.username ?? '—'} />
              <DetailRow label="Approved At" value={formatDateTime(viewCorrection.approvedAt)} />
              <DetailRow label="Rejected Reason" value={viewCorrection.rejectedReason ?? '—'} />
              <DetailRow label="Rejected At" value={formatDateTime(viewCorrection.rejectedAt)} />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">Before Snapshot</p>
              <pre className="max-h-40 overflow-auto rounded-md bg-surface-muted p-3 text-xs text-muted-foreground">
                {JSON.stringify(viewCorrection.beforeSnapshot, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">After Snapshot</p>
              <pre className="max-h-40 overflow-auto rounded-md bg-surface-muted p-3 text-xs text-muted-foreground">
                {JSON.stringify(viewCorrection.afterSnapshot, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </FormModal>

      <FormModal open={requestFormOpen} title="Request Attendance Correction" onClose={() => setRequestFormOpen(false)}>
        <form
          onSubmit={requestForm.handleSubmit((values) => requestMutation.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormField
            label="Employee"
            htmlFor="req-employee"
            required
            error={requestForm.formState.errors.employeeId?.message}
          >
            <Select id="req-employee" {...requestForm.register('employeeId')}>
              <option value="">— Select —</option>
              {(employeesQuery.data?.data ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} ({employee.employeeCode})
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Work Date"
              htmlFor="req-work-date"
              required
              error={requestForm.formState.errors.workDate?.message}
            >
              <Input id="req-work-date" type="date" {...requestForm.register('workDate')} />
            </FormField>
            <FormField label="Correction Type" htmlFor="req-type" required>
              <Select
                id="req-type"
                {...requestForm.register('correctionType', {
                  onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
                    setSelectedType(event.target.value as CorrectionType),
                })}
              >
                {CORRECTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          {selectedType === 'MANUAL_ADJUSTMENT' ? (
            <FormField label="Requested Punch Type" htmlFor="req-punch-type" required>
              <Select id="req-punch-type" {...requestForm.register('requestedPunchType')}>
                {PUNCH_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {selectedType !== 'OTHER' ? (
            <FormField
              label="Requested Punch Time"
              htmlFor="req-punch-time"
              required
              error={requestForm.formState.errors.requestedPunchTime?.message}
            >
              <Input id="req-punch-time" type="datetime-local" {...requestForm.register('requestedPunchTime')} />
            </FormField>
          ) : null}
          {selectedType === 'WRONG_IN' || selectedType === 'WRONG_OUT' ? (
            <FormField
              label="Target Punch ID"
              htmlFor="req-target-punch"
              required
              error={requestForm.formState.errors.targetPunchId?.message}
            >
              <Input id="req-target-punch" {...requestForm.register('targetPunchId')} />
            </FormField>
          ) : null}
          <FormField label="Reason" htmlFor="req-reason" required error={requestForm.formState.errors.reason?.message}>
            <Textarea id="req-reason" {...requestForm.register('reason')} />
          </FormField>
          {requestMutation.isError ? (
            <ErrorAlert message={errorMessage(requestMutation.error, 'Failed to request correction.')} />
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRequestFormOpen(false)}
              disabled={requestMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={requestMutation.isPending}>
              {requestMutation.isPending ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                'Submit'
              )}
            </Button>
          </div>
        </form>
      </FormModal>

      <ConfirmDialog
        open={approveTarget !== null}
        title="Approve correction?"
        description="Approving will create a manual raw punch (where applicable) and recalculate the day's attendance summary through the backend."
        confirmLabel="Approve"
        isLoading={approveMutation.isPending}
        onConfirm={() => approveTarget && approveMutation.mutate(approveTarget.id)}
        onCancel={() => setApproveTarget(null)}
      />

      <ReasonDialog
        key={rejectTarget?.id ?? 'closed'}
        open={rejectTarget !== null}
        title="Reject correction?"
        description="Provide a reason for rejecting this correction request. The employee/requester should see this reason."
        confirmLabel="Reject"
        isLoading={rejectMutation.isPending}
        error={rejectMutation.isError ? errorMessage(rejectMutation.error, 'Failed to reject correction.') : undefined}
        onConfirm={(reason) => rejectTarget && rejectMutation.mutate({ id: rejectTarget.id, reason })}
        onCancel={() => setRejectTarget(null)}
      />
    </div>
  );
}
