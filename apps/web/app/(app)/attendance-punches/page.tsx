'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlayCircle, Plus, ShieldCheck } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  ATTENDANCE_SOURCE_TYPES,
  createDeviceImportPunch,
  createManualPunch,
  listAttendancePunches,
  PUNCH_TYPES,
  PUNCH_VALIDATION_STATUSES,
  validatePendingPunches,
  validatePunch,
  type AttendanceRawPunch,
  type AttendanceSourceType,
  type PunchType,
  type PunchValidationStatus,
} from '@/lib/api/attendance-punches';
import { listAttendanceDevices } from '@/lib/api/attendance-devices';
import { ApiError } from '@/lib/api/client';
import { listEmployees } from '@/lib/api/employees';
import { listWorkLocations } from '@/lib/api/work-locations';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const SOURCE_TYPE_LABELS: Record<AttendanceSourceType, string> = {
  MOBILE: 'Mobile',
  BIOMETRIC_DEVICE: 'Biometric Device',
  FACE_DEVICE: 'Face Device',
  CARD_DEVICE: 'Card Device',
  WEB: 'Web',
  MANUAL_CORRECTION: 'Manual Correction',
  IMPORT: 'Import',
  FUTURE_INTEGRATION: 'Future Integration',
};

const SOURCE_TYPE_TONES: Record<AttendanceSourceType, BadgeTone> = {
  MOBILE: 'info',
  BIOMETRIC_DEVICE: 'muted',
  FACE_DEVICE: 'muted',
  CARD_DEVICE: 'muted',
  WEB: 'muted',
  MANUAL_CORRECTION: 'info',
  IMPORT: 'muted',
  FUTURE_INTEGRATION: 'muted',
};

const VALIDATION_STATUS_LABELS: Record<PunchValidationStatus, string> = {
  ACCEPTED: 'Accepted',
  ACCEPTED_WITH_WARNING: 'Accepted (Warning)',
  REJECTED_OUTSIDE_LOCATION: 'Rejected: Outside Location',
  REJECTED_FAKE_GPS: 'Rejected: Fake GPS',
  REJECTED_UNREGISTERED_DEVICE: 'Rejected: Unregistered Device',
  REJECTED_EMPLOYEE_INACTIVE: 'Rejected: Employee Inactive',
  REJECTED_DUPLICATE: 'Duplicate',
  PENDING_HR_REVIEW: 'Pending HR Review',
  PENDING_MANAGER_APPROVAL: 'Pending Manager Approval',
  REJECTED_POLICY_VIOLATION: 'Rejected: Policy Violation',
};

// Matches context/ui-context.md's punch-validation badge conventions.
const VALIDATION_STATUS_TONES: Record<PunchValidationStatus, BadgeTone> = {
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

const VALIDATABLE_STATUSES: PunchValidationStatus[] = [
  'PENDING_HR_REVIEW',
  'PENDING_MANAGER_APPROVAL',
  'REJECTED_OUTSIDE_LOCATION',
  'REJECTED_FAKE_GPS',
  'REJECTED_UNREGISTERED_DEVICE',
  'REJECTED_EMPLOYEE_INACTIVE',
  'REJECTED_DUPLICATE',
  'REJECTED_POLICY_VIOLATION',
];

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString();
}

function formatFraudFlags(flags: Record<string, unknown>[]): string {
  if (!flags || flags.length === 0) {
    return '—';
  }
  const names = flags.map((flag) => (typeof flag.flag === 'string' ? flag.flag : 'unknown')).filter(Boolean);
  return names.length > 0 ? names.join(', ') : '—';
}

const optionalString = (max: number) => z.string().max(max).optional().or(z.literal(''));

const manualPunchSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  punchType: z.enum(['IN', 'OUT', 'BREAK_START', 'BREAK_END']),
  punchTimeSource: z.string().min(1, 'Punch time is required'),
  reason: z.string().min(1, 'Reason is required').max(1000),
});
type ManualPunchFormValues = z.infer<typeof manualPunchSchema>;

const deviceImportSchema = z.object({
  attendanceDeviceId: z.string().min(1, 'Device is required'),
  sourceId: optionalString(255),
  employeeCode: z.string().min(1, 'Employee code is required').max(50),
  punchType: z.enum(['IN', 'OUT', 'BREAK_START', 'BREAK_END']),
  punchTimeSource: z.string().min(1, 'Punch time is required'),
});
type DeviceImportFormValues = z.infer<typeof deviceImportSchema>;

const validatePendingSchema = z.object({
  employeeId: optionalString(100),
  from: optionalString(30),
  to: optionalString(30),
  limit: z.number().int().min(1).max(100).optional(),
});
type ValidatePendingFormValues = z.infer<typeof validatePendingSchema>;

export default function AttendancePunchesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'attendancePunches.read');
  const canValidate = hasPermission(user, 'attendancePunches.validate');
  const canCreateManual = hasPermission(user, 'attendancePunches.createManual');
  const canCreateDeviceImport = hasPermission(user, 'attendancePunches.createDeviceImport');

  const [page, setPage] = React.useState(1);
  const [employeeIdFilter, setEmployeeIdFilter] = React.useState('');
  const [workLocationFilter, setWorkLocationFilter] = React.useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = React.useState('');
  const [punchTypeFilter, setPunchTypeFilter] = React.useState('');
  const [validationStatusFilter, setValidationStatusFilter] = React.useState('');
  const [fromFilter, setFromFilter] = React.useState('');
  const [toFilter, setToFilter] = React.useState('');

  const [viewPunch, setViewPunch] = React.useState<AttendanceRawPunch | null>(null);
  const [manualFormOpen, setManualFormOpen] = React.useState(false);
  const [deviceImportFormOpen, setDeviceImportFormOpen] = React.useState(false);
  const [validatePendingOpen, setValidatePendingOpen] = React.useState(false);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: [
      'attendance-punches',
      { page, employeeIdFilter, workLocationFilter, sourceTypeFilter, punchTypeFilter, validationStatusFilter, fromFilter, toFilter },
    ],
    queryFn: () =>
      listAttendancePunches({
        page,
        limit: 20,
        employeeId: employeeIdFilter || undefined,
        workLocationId: workLocationFilter || undefined,
        sourceType: (sourceTypeFilter || undefined) as AttendanceSourceType | undefined,
        punchType: (punchTypeFilter || undefined) as PunchType | undefined,
        validationStatus: (validationStatusFilter || undefined) as PunchValidationStatus | undefined,
        from: fromFilter || undefined,
        to: toFilter || undefined,
      }),
    enabled: canRead,
    placeholderData: (previous) => previous,
  });

  const workLocationsQuery = useQuery({
    queryKey: ['work-locations', 'active-for-dropdown'],
    queryFn: () => listWorkLocations({ isActive: true, limit: 100 }),
    enabled: canRead,
  });
  const employeesQuery = useQuery({
    queryKey: ['employees', 'active-for-dropdown'],
    queryFn: () => listEmployees({ limit: 100 }),
    enabled: canCreateManual || canCreateDeviceImport,
  });
  const devicesQuery = useQuery({
    queryKey: ['attendance-devices', 'active-for-dropdown'],
    queryFn: () => listAttendanceDevices({ isActive: true, limit: 100 }),
    enabled: canCreateDeviceImport,
  });

  const validateMutation = useMutation({
    mutationFn: (id: string) => validatePunch(id),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-punches'] });
      setSuccessMessage(`Punch validated: ${VALIDATION_STATUS_LABELS[updated.validationStatus]}.`);
    },
  });

  const manualForm = useForm<ManualPunchFormValues>({
    resolver: zodResolver(manualPunchSchema),
    defaultValues: { employeeId: '', punchType: 'IN', punchTimeSource: '', reason: '' },
  });
  const manualMutation = useMutation({
    mutationFn: (values: ManualPunchFormValues) =>
      createManualPunch({
        employeeId: values.employeeId,
        punchType: values.punchType,
        punchTimeSource: new Date(values.punchTimeSource).toISOString(),
        reason: values.reason,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-punches'] });
      setSuccessMessage('Manual punch created (pending review).');
      setManualFormOpen(false);
      manualForm.reset();
    },
  });

  const deviceImportForm = useForm<DeviceImportFormValues>({
    resolver: zodResolver(deviceImportSchema),
    defaultValues: { attendanceDeviceId: '', sourceId: '', employeeCode: '', punchType: 'IN', punchTimeSource: '' },
  });
  const deviceImportMutation = useMutation({
    mutationFn: (values: DeviceImportFormValues) =>
      createDeviceImportPunch({
        attendanceDeviceId: values.attendanceDeviceId,
        sourceId: values.sourceId || undefined,
        employeeCode: values.employeeCode,
        punchType: values.punchType,
        punchTimeSource: new Date(values.punchTimeSource).toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-punches'] });
      setSuccessMessage('Device-import punch created.');
      setDeviceImportFormOpen(false);
      deviceImportForm.reset();
    },
  });

  const validatePendingForm = useForm<ValidatePendingFormValues>({
    resolver: zodResolver(validatePendingSchema),
    defaultValues: { employeeId: '', from: '', to: '', limit: 20 },
  });
  const validatePendingMutation = useMutation({
    mutationFn: (values: ValidatePendingFormValues) =>
      validatePendingPunches({
        employeeId: values.employeeId || undefined,
        from: values.from ? new Date(values.from).toISOString() : undefined,
        to: values.to ? new Date(values.to).toISOString() : undefined,
        limit: values.limit,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-punches'] });
      setSuccessMessage(
        `Processed ${result.totalProcessed} pending punch(es): ${result.accepted} accepted, ${result.rejected} rejected, ${result.pending} still pending.`,
      );
      setValidatePendingOpen(false);
      validatePendingForm.reset();
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const columns: DataTableColumn<AttendanceRawPunch>[] = [
    {
      key: 'employee',
      header: 'Employee',
      render: (row) =>
        row.employee ? `${row.employee.firstName} ${row.employee.lastName} (${row.employee.employeeCode})` : row.employeeId,
    },
    { key: 'punchType', header: 'Type', render: (row) => row.punchType },
    {
      key: 'sourceType',
      header: 'Source',
      render: (row) => <StatusBadge label={SOURCE_TYPE_LABELS[row.sourceType]} tone={SOURCE_TYPE_TONES[row.sourceType]} />,
    },
    { key: 'punchTimeSource', header: 'Time', render: (row) => formatDateTime(row.punchTimeSource) },
    {
      key: 'validationStatus',
      header: 'Validation',
      render: (row) => (
        <StatusBadge label={VALIDATION_STATUS_LABELS[row.validationStatus]} tone={VALIDATION_STATUS_TONES[row.validationStatus]} />
      ),
    },
    {
      key: 'isOfficial',
      header: 'Official',
      render: (row) =>
        row.isOfficial ? <StatusBadge label="Official" tone="success" /> : <span className="text-subtle-foreground">—</span>,
    },
    { key: 'fraudScore', header: 'Fraud Score', render: (row) => row.fraudScore },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setViewPunch(row)}>
            View
          </Button>
          {canValidate && VALIDATABLE_STATUSES.includes(row.validationStatus) ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => validateMutation.mutate(row.id)}
              disabled={validateMutation.isPending}
            >
              Validate
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
          <h1 className="text-2xl font-semibold text-foreground">Raw Punches</h1>
          <p className="text-sm text-muted-foreground">
            Immutable raw attendance events from mobile, devices, and manual entry.
          </p>
        </div>
        <div className="flex gap-2">
          {canValidate ? (
            <Button variant="outline" onClick={() => setValidatePendingOpen(true)}>
              <ShieldCheck className="h-4 w-4" />
              Validate Pending
            </Button>
          ) : null}
          {canCreateDeviceImport ? (
            <Button variant="outline" onClick={() => setDeviceImportFormOpen(true)}>
              <PlayCircle className="h-4 w-4" />
              Simulate Device Import
            </Button>
          ) : null}
          {canCreateManual ? (
            <Button onClick={() => setManualFormOpen(true)}>
              <Plus className="h-4 w-4" />
              Manual Punch
            </Button>
          ) : null}
        </div>
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {listQuery.isError ? <ErrorAlert message={errorMessage(listQuery.error, 'Failed to load raw punches.')} /> : null}
      {validateMutation.isError ? (
        <ErrorAlert message={errorMessage(validateMutation.error, 'Failed to validate punch.')} />
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
          value={workLocationFilter}
          onChange={(event) => {
            setWorkLocationFilter(event.target.value);
            setPage(1);
          }}
          className="w-44"
        >
          <option value="">All work locations</option>
          {(workLocationsQuery.data?.data ?? []).map((wl) => (
            <option key={wl.id} value={wl.id}>
              {wl.name}
            </option>
          ))}
        </Select>
        <Select
          value={sourceTypeFilter}
          onChange={(event) => {
            setSourceTypeFilter(event.target.value);
            setPage(1);
          }}
          className="w-44"
        >
          <option value="">All sources</option>
          {ATTENDANCE_SOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {SOURCE_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
        <Select
          value={punchTypeFilter}
          onChange={(event) => {
            setPunchTypeFilter(event.target.value);
            setPage(1);
          }}
          className="w-36"
        >
          <option value="">All punch types</option>
          {PUNCH_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <Select
          value={validationStatusFilter}
          onChange={(event) => {
            setValidationStatusFilter(event.target.value);
            setPage(1);
          }}
          className="w-52"
        >
          <option value="">All validation statuses</option>
          {PUNCH_VALIDATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {VALIDATION_STATUS_LABELS[status]}
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
        emptyMessage="No raw punches found."
      />

      {listQuery.data ? (
        <PaginationControls
          page={listQuery.data.meta.page}
          totalPages={listQuery.data.meta.totalPages}
          total={listQuery.data.meta.total}
          onPageChange={setPage}
        />
      ) : null}

      <FormModal open={viewPunch !== null} title="Punch Details" onClose={() => setViewPunch(null)}>
        {viewPunch ? (
          <div className="flex flex-col">
            <DetailRow
              label="Employee"
              value={
                viewPunch.employee
                  ? `${viewPunch.employee.firstName} ${viewPunch.employee.lastName} (${viewPunch.employee.employeeCode})`
                  : viewPunch.employeeId
              }
            />
            <DetailRow label="Punch Type" value={viewPunch.punchType} />
            <DetailRow label="Source Type" value={SOURCE_TYPE_LABELS[viewPunch.sourceType]} />
            <DetailRow label="Source ID" value={viewPunch.sourceId ?? '—'} />
            <DetailRow label="Punch Time (source)" value={formatDateTime(viewPunch.punchTimeSource)} />
            <DetailRow label="Punch Time (server)" value={formatDateTime(viewPunch.punchTimeServer)} />
            <DetailRow
              label="Work Location"
              value={viewPunch.workLocation?.name ?? viewPunch.workLocationId ?? '—'}
            />
            <DetailRow
              label="Coordinates"
              value={
                viewPunch.latitude != null && viewPunch.longitude != null
                  ? `${viewPunch.latitude.toFixed(5)}, ${viewPunch.longitude.toFixed(5)}`
                  : '—'
              }
            />
            <DetailRow label="GPS Accuracy (m)" value={viewPunch.gpsAccuracy ?? '—'} />
            <DetailRow label="Distance From Location (m)" value={viewPunch.distanceFromLocationMeters ?? '—'} />
            <DetailRow
              label="Validation Status"
              value={<StatusBadge label={VALIDATION_STATUS_LABELS[viewPunch.validationStatus]} tone={VALIDATION_STATUS_TONES[viewPunch.validationStatus]} />}
            />
            <DetailRow label="Fraud Score" value={viewPunch.fraudScore} />
            <DetailRow label="Fraud Flags" value={formatFraudFlags(viewPunch.fraudFlags)} />
            <DetailRow label="Official" value={viewPunch.isOfficial ? 'Yes' : 'No'} />
            <DetailRow label="Duplicate Of" value={viewPunch.duplicateOfPunchId ?? '—'} />
            <DetailRow label="Validated At" value={formatDateTime(viewPunch.validatedAt)} />
            <DetailRow label="Mobile Device" value={viewPunch.mobileDevice?.deviceIdentifier ?? '—'} />
            <DetailRow label="Attendance Device" value={viewPunch.attendanceDevice?.name ?? '—'} />
            <DetailRow label="Created At" value={formatDateTime(viewPunch.createdAt)} />
          </div>
        ) : null}
      </FormModal>

      <FormModal open={manualFormOpen} title="Create Manual Punch" onClose={() => setManualFormOpen(false)}>
        <form
          onSubmit={manualForm.handleSubmit((values) => manualMutation.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormField
            label="Employee"
            htmlFor="manual-employee"
            required
            error={manualForm.formState.errors.employeeId?.message}
          >
            <Select id="manual-employee" {...manualForm.register('employeeId')}>
              <option value="">— Select —</option>
              {(employeesQuery.data?.data ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} ({employee.employeeCode})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Punch Type" htmlFor="manual-punch-type" required>
            <Select id="manual-punch-type" {...manualForm.register('punchType')}>
              {PUNCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Punch Time"
            htmlFor="manual-punch-time"
            required
            error={manualForm.formState.errors.punchTimeSource?.message}
          >
            <Input id="manual-punch-time" type="datetime-local" {...manualForm.register('punchTimeSource')} />
          </FormField>
          <FormField label="Reason" htmlFor="manual-reason" required error={manualForm.formState.errors.reason?.message}>
            <Textarea id="manual-reason" {...manualForm.register('reason')} />
          </FormField>
          {manualMutation.isError ? (
            <ErrorAlert message={errorMessage(manualMutation.error, 'Failed to create manual punch.')} />
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setManualFormOpen(false)} disabled={manualMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={manualMutation.isPending}>
              {manualMutation.isPending ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                'Create'
              )}
            </Button>
          </div>
        </form>
      </FormModal>

      <FormModal open={deviceImportFormOpen} title="Simulate Device Import" onClose={() => setDeviceImportFormOpen(false)}>
        <form
          onSubmit={deviceImportForm.handleSubmit((values) => deviceImportMutation.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormField
            label="Attendance Device"
            htmlFor="import-device"
            required
            error={deviceImportForm.formState.errors.attendanceDeviceId?.message}
          >
            <Select id="import-device" {...deviceImportForm.register('attendanceDeviceId')}>
              <option value="">— Select —</option>
              {(devicesQuery.data?.data ?? []).map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} ({device.deviceCode})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Employee Code"
            htmlFor="import-employee-code"
            required
            error={deviceImportForm.formState.errors.employeeCode?.message}
          >
            <Input id="import-employee-code" {...deviceImportForm.register('employeeCode')} />
          </FormField>
          <FormField label="Source ID" htmlFor="import-source-id" error={deviceImportForm.formState.errors.sourceId?.message}>
            <Input id="import-source-id" {...deviceImportForm.register('sourceId')} />
          </FormField>
          <FormField label="Punch Type" htmlFor="import-punch-type" required>
            <Select id="import-punch-type" {...deviceImportForm.register('punchType')}>
              {PUNCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Punch Time"
            htmlFor="import-punch-time"
            required
            error={deviceImportForm.formState.errors.punchTimeSource?.message}
          >
            <Input id="import-punch-time" type="datetime-local" {...deviceImportForm.register('punchTimeSource')} />
          </FormField>
          {deviceImportMutation.isError ? (
            <ErrorAlert message={errorMessage(deviceImportMutation.error, 'Failed to import punch.')} />
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeviceImportFormOpen(false)}
              disabled={deviceImportMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={deviceImportMutation.isPending}>
              {deviceImportMutation.isPending ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                'Import'
              )}
            </Button>
          </div>
        </form>
      </FormModal>

      <FormModal open={validatePendingOpen} title="Validate Pending Punches" onClose={() => setValidatePendingOpen(false)}>
        <form
          onSubmit={validatePendingForm.handleSubmit((values) => validatePendingMutation.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <p className="text-sm text-muted-foreground">
            Runs the validation engine over currently pending punches, optionally scoped below.
          </p>
          <FormField label="Employee ID (optional)" htmlFor="vp-employee">
            <Input id="vp-employee" {...validatePendingForm.register('employeeId')} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="From (optional)" htmlFor="vp-from">
              <Input id="vp-from" type="date" {...validatePendingForm.register('from')} />
            </FormField>
            <FormField label="To (optional)" htmlFor="vp-to">
              <Input id="vp-to" type="date" {...validatePendingForm.register('to')} />
            </FormField>
          </div>
          <FormField label="Limit (max 100)" htmlFor="vp-limit">
            <Input
              id="vp-limit"
              type="number"
              step="1"
              {...validatePendingForm.register('limit', {
                setValueAs: (value: string) => (value === '' ? undefined : Number(value)),
              })}
            />
          </FormField>
          {validatePendingMutation.isError ? (
            <ErrorAlert message={errorMessage(validatePendingMutation.error, 'Failed to validate pending punches.')} />
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setValidatePendingOpen(false)}
              disabled={validatePendingMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={validatePendingMutation.isPending}>
              {validatePendingMutation.isPending ? (
                <>
                  <Spinner /> Running…
                </>
              ) : (
                'Run'
              )}
            </Button>
          </div>
        </form>
      </FormModal>
    </div>
  );
}
