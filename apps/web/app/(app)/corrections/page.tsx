'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { Spinner } from '@/components/admin/spinner';
import { SuccessBanner } from '@/components/admin/success-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import {
  CORRECTION_TYPES,
  listMyAttendanceCorrections,
  requestAttendanceCorrection,
  type AttendanceCorrection,
  type CorrectionStatus,
  type CorrectionType,
} from '@/lib/api/attendance-corrections';
import { PUNCH_TYPES, type PunchType } from '@/lib/api/attendance-punches';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '@/lib/auth/no-employee-message';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// Matches the labels/tones already used on the admin Attendance Corrections screen.
const STATUS_LABELS: Record<CorrectionStatus, string> = {
  PENDING: 'Waiting for approval',
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

// Mirrors the backend's own RequestCorrectionDto @ValidateIf rules (same source of truth used by the mobile Unit 19 form).
const TYPES_REQUIRING_PUNCH_TYPE: CorrectionType[] = ['MANUAL_ADJUSTMENT'];
const TYPES_REQUIRING_PUNCH_TIME: CorrectionType[] = [
  'MISSED_IN',
  'MISSED_OUT',
  'WRONG_IN',
  'WRONG_OUT',
  'MANUAL_ADJUSTMENT',
];
const TYPES_REQUIRING_TARGET_PUNCH: CorrectionType[] = ['WRONG_IN', 'WRONG_OUT'];

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

interface RequestCorrectionFormValues {
  workDate: string;
  correctionType: CorrectionType;
  requestedPunchType: PunchType | '';
  requestedPunchTime: string;
  targetPunchId: string;
  reason: string;
}

function RequestCorrectionModalContent({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RequestCorrectionFormValues>({
    defaultValues: {
      workDate: '',
      correctionType: 'MISSED_IN',
      requestedPunchType: '',
      requestedPunchTime: '',
      targetPunchId: '',
      reason: '',
    },
  });

  const selectedType = useWatch({ control, name: 'correctionType' });
  const needsPunchType = TYPES_REQUIRING_PUNCH_TYPE.includes(selectedType);
  const needsPunchTime = TYPES_REQUIRING_PUNCH_TIME.includes(selectedType);
  const needsTargetPunch = TYPES_REQUIRING_TARGET_PUNCH.includes(selectedType);

  const mutation = useMutation({
    mutationFn: (values: RequestCorrectionFormValues) =>
      requestAttendanceCorrection({
        workDate: values.workDate,
        correctionType: values.correctionType,
        requestedPunchType: needsPunchType && values.requestedPunchType ? values.requestedPunchType : undefined,
        requestedPunchTime: needsPunchTime ? values.requestedPunchTime : undefined,
        targetPunchId: needsTargetPunch ? values.targetPunchId : undefined,
        reason: values.reason,
      }),
    onSuccess: () => {
      reset();
      onSuccess();
    },
  });

  return (
    <FormModal open title="Request Correction" onClose={onClose}>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="flex flex-col gap-4" noValidate>
        <FormField label="Work Date" htmlFor="corr-work-date" required error={errors.workDate?.message}>
          <Controller
            control={control}
            name="workDate"
            rules={{ required: 'Work date is required' }}
            render={({ field }) => <Input id="corr-work-date" type="date" {...field} />}
          />
        </FormField>

        <FormField label="Correction Type" htmlFor="corr-type" required>
          <Controller
            control={control}
            name="correctionType"
            render={({ field }) => (
              <Select id="corr-type" {...field}>
                {CORRECTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            )}
          />
        </FormField>

        {needsPunchType ? (
          <FormField label="Requested Punch Type" htmlFor="corr-punch-type" required error={errors.requestedPunchType?.message}>
            <Controller
              control={control}
              name="requestedPunchType"
              rules={{ required: needsPunchType ? 'Requested punch type is required' : false }}
              render={({ field }) => (
                <Select id="corr-punch-type" {...field}>
                  <option value="">— Select —</option>
                  {PUNCH_TYPES.filter((type) => type === 'IN' || type === 'OUT').map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </Select>
              )}
            />
          </FormField>
        ) : null}

        {needsPunchTime ? (
          <FormField
            label="Requested Punch Time"
            htmlFor="corr-punch-time"
            required
            error={errors.requestedPunchTime?.message}
          >
            <Controller
              control={control}
              name="requestedPunchTime"
              rules={{ required: needsPunchTime ? 'Requested punch time is required' : false }}
              render={({ field }) => <Input id="corr-punch-time" type="datetime-local" {...field} />}
            />
          </FormField>
        ) : null}

        {needsTargetPunch ? (
          <FormField
            label="Related Punch ID"
            htmlFor="corr-target-punch"
            required
            error={errors.targetPunchId?.message}
          >
            <Controller
              control={control}
              name="targetPunchId"
              rules={{ required: needsTargetPunch ? 'Related punch ID is required for this correction type' : false }}
              render={({ field }) => <Input id="corr-target-punch" {...field} />}
            />
          </FormField>
        ) : null}

        <FormField label="Reason" htmlFor="corr-reason" required error={errors.reason?.message}>
          <Controller
            control={control}
            name="reason"
            rules={{ required: 'Reason is required', maxLength: { value: 1000, message: 'Max 1000 characters' } }}
            render={({ field }) => (
              <Textarea id="corr-reason" rows={3} placeholder="Forgot to punch out due to site work…" {...field} />
            )}
          />
        </FormField>

        {mutation.isError ? <ErrorAlert message={errorMessage(mutation.error, 'Failed to submit request.')} /> : null}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Spinner /> Submitting…
              </>
            ) : (
              'Submit Request'
            )}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}

function RequestCorrectionModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  if (!open) {
    return null;
  }
  return <RequestCorrectionModalContent onClose={onClose} onSuccess={onSuccess} />;
}

export default function CorrectionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const hasEmployee = user?.employeeId != null;

  const [requestOpen, setRequestOpen] = React.useState(false);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['my-attendance-corrections'],
    queryFn: () => listMyAttendanceCorrections({ limit: 20 }),
    enabled: hasEmployee,
  });

  if (!hasEmployee) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My Corrections</h1>
        </div>
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {NO_EMPLOYEE_MESSAGE}
        </div>
      </div>
    );
  }

  const columns: DataTableColumn<AttendanceCorrection>[] = [
    { key: 'workDate', header: 'Date', render: (row) => formatDate(row.workDate) },
    { key: 'correctionType', header: 'Type', render: (row) => TYPE_LABELS[row.correctionType] },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge label={STATUS_LABELS[row.status]} tone={STATUS_TONES[row.status]} />,
    },
    { key: 'reason', header: 'Reason', render: (row) => <span className="line-clamp-2">{row.reason}</span> },
    {
      key: 'result',
      header: 'Result',
      render: (row) =>
        row.status === 'REJECTED' && row.rejectedReason ? (
          <span className="text-error">Rejected: {row.rejectedReason}</span>
        ) : row.status === 'APPROVED' ? (
          <span className="text-success">Approved {formatDateTime(row.approvedAt)}</span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My Corrections</h1>
          <p className="text-sm text-muted-foreground">Request or review your own attendance corrections.</p>
        </div>
        <Button onClick={() => setRequestOpen(true)}>
          <Plus className="h-4 w-4" />
          Request Correction
        </Button>
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {query.isError ? <ErrorAlert message={errorMessage(query.error, 'Failed to load corrections.')} /> : null}

      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        getRowId={(row) => row.id}
        isLoading={query.isLoading}
        emptyMessage="No correction requests yet."
      />

      <RequestCorrectionModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ['my-attendance-corrections'] });
          setSuccessMessage('Correction request submitted. Waiting for approval.');
          setRequestOpen(false);
        }}
      />
    </div>
  );
}
