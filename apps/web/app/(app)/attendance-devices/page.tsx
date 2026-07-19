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
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { PaginationControls } from '@/components/admin/pagination-controls';
import { SearchInput } from '@/components/admin/search-input';
import { Spinner } from '@/components/admin/spinner';
import { SuccessBanner } from '@/components/admin/success-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import {
  ATTENDANCE_CONNECTION_MODES,
  ATTENDANCE_DEVICE_TYPES,
  createAttendanceDevice,
  deactivateAttendanceDevice,
  listAttendanceDevices,
  testAttendanceDeviceConnection,
  updateAttendanceDevice,
  type AttendanceConnectionMode,
  type AttendanceDevice,
  type AttendanceDeviceType,
} from '@/lib/api/attendance-devices';
import { ApiError } from '@/lib/api/client';
import { listWorkLocations } from '@/lib/api/work-locations';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const DEVICE_TYPE_LABELS: Record<AttendanceDeviceType, string> = {
  BIOMETRIC: 'Biometric',
  FACE_RECOGNITION: 'Face Recognition',
  CARD: 'Card',
  QR_TERMINAL: 'QR Terminal',
  TURNSTILE: 'Turnstile',
  OTHER: 'Other',
};

const CONNECTION_MODE_LABELS: Record<AttendanceConnectionMode, string> = {
  NETWORK_PULL: 'Network Pull',
  API: 'API',
  DATABASE_SYNC: 'Database Sync',
  FILE_IMPORT: 'File Import',
  MANUAL_IMPORT: 'Manual Import',
  UNKNOWN: 'Unknown',
};

const optionalString = (max: number) => z.string().max(max).optional().or(z.literal(''));

const deviceFormSchema = z.object({
  deviceCode: z.string().min(1, 'Device code is required').max(50),
  name: z.string().min(1, 'Name is required').max(200),
  deviceType: z.enum(['BIOMETRIC', 'FACE_RECOGNITION', 'CARD', 'QR_TERMINAL', 'TURNSTILE', 'OTHER']),
  vendor: optionalString(100),
  model: optionalString(100),
  serialNumber: optionalString(100),
  workLocationId: z.string().min(1, 'Work location is required'),
  ipAddress: optionalString(255),
  port: z
    .number()
    .int('Port must be a whole number')
    .min(1, 'Port must be between 1 and 65535')
    .max(65535, 'Port must be between 1 and 65535')
    .optional(),
  connectionMode: z.enum(['NETWORK_PULL', 'API', 'DATABASE_SYNC', 'FILE_IMPORT', 'MANUAL_IMPORT', 'UNKNOWN']),
  notes: optionalString(1000),
});

type DeviceFormValues = z.infer<typeof deviceFormSchema>;

export default function AttendanceDevicesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'attendanceDevices.read');
  const canCreate = hasPermission(user, 'attendanceDevices.create');
  const canUpdate = hasPermission(user, 'attendanceDevices.update');
  const canDeactivate = hasPermission(user, 'attendanceDevices.disable');
  const canTestConnection = hasPermission(user, 'attendanceDevices.testConnection');

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [workLocationFilter, setWorkLocationFilter] = React.useState('');
  const [deviceTypeFilter, setDeviceTypeFilter] = React.useState('');
  const [connectionModeFilter, setConnectionModeFilter] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState('');
  const [formState, setFormState] = React.useState<{ mode: 'create' | 'edit'; device: AttendanceDevice | null } | null>(
    null,
  );
  const [deactivateTarget, setDeactivateTarget] = React.useState<AttendanceDevice | null>(null);
  const [testResult, setTestResult] = React.useState<{ deviceId: string; message: string } | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['attendance-devices', { page, search, workLocationFilter, deviceTypeFilter, connectionModeFilter, activeFilter }],
    queryFn: () =>
      listAttendanceDevices({
        page,
        limit: 20,
        search: search || undefined,
        workLocationId: workLocationFilter || undefined,
        deviceType: (deviceTypeFilter || undefined) as AttendanceDeviceType | undefined,
        connectionMode: (connectionModeFilter || undefined) as AttendanceConnectionMode | undefined,
        isActive: activeFilter === '' ? undefined : activeFilter === 'true',
      }),
    enabled: canRead,
    placeholderData: (previous) => previous,
  });

  // Unfiltered (not just active) so the table can still show the linked location name for a
  // device whose work location was later deactivated — the backend does not include this relation.
  const workLocationsQuery = useQuery({
    queryKey: ['work-locations', 'all-for-lookup'],
    queryFn: () => listWorkLocations({ limit: 100 }),
    enabled: canRead,
  });
  const workLocationName = React.useCallback(
    (id: string) => workLocationsQuery.data?.data.find((wl) => wl.id === id)?.name ?? id,
    [workLocationsQuery.data],
  );
  const activeWorkLocations = (workLocationsQuery.data?.data ?? []).filter((wl) => wl.isActive);

  const form = useForm<DeviceFormValues>({
    resolver: zodResolver(deviceFormSchema),
    defaultValues: {
      deviceCode: '',
      name: '',
      deviceType: 'BIOMETRIC',
      vendor: '',
      model: '',
      serialNumber: '',
      workLocationId: '',
      ipAddress: '',
      connectionMode: 'UNKNOWN',
      notes: '',
    },
  });

  function openCreateForm() {
    form.reset({
      deviceCode: '',
      name: '',
      deviceType: 'BIOMETRIC',
      vendor: '',
      model: '',
      serialNumber: '',
      workLocationId: '',
      ipAddress: '',
      port: undefined,
      connectionMode: 'UNKNOWN',
      notes: '',
    });
    setFormState({ mode: 'create', device: null });
  }

  function openEditForm(device: AttendanceDevice) {
    form.reset({
      deviceCode: device.deviceCode,
      name: device.name,
      deviceType: device.deviceType,
      vendor: device.vendor ?? '',
      model: device.model ?? '',
      serialNumber: device.serialNumber ?? '',
      workLocationId: device.workLocationId,
      ipAddress: device.ipAddress ?? '',
      port: device.port ?? undefined,
      connectionMode: device.connectionMode,
      notes: device.notes ?? '',
    });
    setFormState({ mode: 'edit', device });
  }

  const saveMutation = useMutation({
    mutationFn: (values: DeviceFormValues) => {
      const input = {
        deviceCode: values.deviceCode,
        name: values.name,
        deviceType: values.deviceType,
        vendor: values.vendor || undefined,
        model: values.model || undefined,
        serialNumber: values.serialNumber || undefined,
        workLocationId: values.workLocationId,
        ipAddress: values.ipAddress || undefined,
        port: values.port,
        connectionMode: values.connectionMode,
        notes: values.notes || undefined,
      };
      return formState?.mode === 'edit' && formState.device
        ? updateAttendanceDevice(formState.device.id, input)
        : createAttendanceDevice(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-devices'] });
      setSuccessMessage(formState?.mode === 'edit' ? 'Attendance device updated.' : 'Attendance device created.');
      setFormState(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateAttendanceDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-devices'] });
      setSuccessMessage('Attendance device deactivated.');
      setDeactivateTarget(null);
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: (id: string) => testAttendanceDeviceConnection(id),
    onSuccess: (result, deviceId) => {
      setTestResult({ deviceId, message: result.message });
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const columns: DataTableColumn<AttendanceDevice>[] = [
    { key: 'name', header: 'Name', render: (row) => row.name },
    { key: 'deviceCode', header: 'Code', render: (row) => row.deviceCode },
    { key: 'deviceType', header: 'Type', render: (row) => DEVICE_TYPE_LABELS[row.deviceType] },
    { key: 'connectionMode', header: 'Connection', render: (row) => CONNECTION_MODE_LABELS[row.connectionMode] },
    { key: 'workLocation', header: 'Work Location', render: (row) => workLocationName(row.workLocationId) },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.isActive ? <StatusBadge label="Active" tone="success" /> : <StatusBadge label="Inactive" tone="muted" />,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex flex-col items-end gap-2">
          <div className="flex justify-end gap-2">
            {canUpdate ? (
              <Button variant="outline" size="sm" onClick={() => openEditForm(row)}>
                Edit
              </Button>
            ) : null}
            {canTestConnection ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => testConnectionMutation.mutate(row.id)}
                disabled={testConnectionMutation.isPending}
              >
                Test Connection
              </Button>
            ) : null}
            {canDeactivate && row.isActive ? (
              <Button variant="outline" size="sm" onClick={() => setDeactivateTarget(row)}>
                Deactivate
              </Button>
            ) : null}
          </div>
          {testResult?.deviceId === row.id ? (
            <p className="max-w-xs text-right text-xs text-muted-foreground">{testResult.message}</p>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Attendance Devices</h1>
          <p className="text-sm text-muted-foreground">Registered biometric, face, and card punching devices.</p>
        </div>
        {canCreate ? (
          <Button onClick={openCreateForm}>
            <Plus className="h-4 w-4" />
            New Device
          </Button>
        ) : null}
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {listQuery.isError ? (
        <ErrorAlert message={errorMessage(listQuery.error, 'Failed to load attendance devices.')} />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search devices…"
        />
        <Select
          value={workLocationFilter}
          onChange={(event) => {
            setWorkLocationFilter(event.target.value);
            setPage(1);
          }}
          className="w-48"
        >
          <option value="">All work locations</option>
          {activeWorkLocations.map((wl) => (
            <option key={wl.id} value={wl.id}>
              {wl.name}
            </option>
          ))}
        </Select>
        <Select
          value={deviceTypeFilter}
          onChange={(event) => {
            setDeviceTypeFilter(event.target.value);
            setPage(1);
          }}
          className="w-44"
        >
          <option value="">All device types</option>
          {ATTENDANCE_DEVICE_TYPES.map((type) => (
            <option key={type} value={type}>
              {DEVICE_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
        <Select
          value={connectionModeFilter}
          onChange={(event) => {
            setConnectionModeFilter(event.target.value);
            setPage(1);
          }}
          className="w-44"
        >
          <option value="">All connections</option>
          {ATTENDANCE_CONNECTION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {CONNECTION_MODE_LABELS[mode]}
            </option>
          ))}
        </Select>
        <Select
          value={activeFilter}
          onChange={(event) => {
            setActiveFilter(event.target.value);
            setPage(1);
          }}
          className="w-36"
        >
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={listQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        isLoading={listQuery.isLoading}
        emptyMessage="No attendance devices found."
      />

      {listQuery.data ? (
        <PaginationControls
          page={listQuery.data.meta.page}
          totalPages={listQuery.data.meta.totalPages}
          total={listQuery.data.meta.total}
          onPageChange={setPage}
        />
      ) : null}

      <FormModal
        open={formState !== null}
        title={formState?.mode === 'edit' ? 'Edit Attendance Device' : 'New Attendance Device'}
        onClose={() => setFormState(null)}
      >
        <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Device Code" htmlFor="dev-code" required error={form.formState.errors.deviceCode?.message}>
              <Input id="dev-code" {...form.register('deviceCode')} />
            </FormField>
            <FormField label="Name" htmlFor="dev-name" required error={form.formState.errors.name?.message}>
              <Input id="dev-name" {...form.register('name')} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Device Type" htmlFor="dev-type" required error={form.formState.errors.deviceType?.message}>
              <Select id="dev-type" {...form.register('deviceType')}>
                {ATTENDANCE_DEVICE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DEVICE_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Work Location"
              htmlFor="dev-work-location"
              required
              error={form.formState.errors.workLocationId?.message}
            >
              <Select id="dev-work-location" {...form.register('workLocationId')}>
                <option value="">— Select —</option>
                {activeWorkLocations.map((wl) => (
                  <option key={wl.id} value={wl.id}>
                    {wl.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Vendor" htmlFor="dev-vendor" error={form.formState.errors.vendor?.message}>
              <Input id="dev-vendor" {...form.register('vendor')} />
            </FormField>
            <FormField label="Model" htmlFor="dev-model" error={form.formState.errors.model?.message}>
              <Input id="dev-model" {...form.register('model')} />
            </FormField>
          </div>
          <FormField label="Serial Number" htmlFor="dev-serial" error={form.formState.errors.serialNumber?.message}>
            <Input id="dev-serial" {...form.register('serialNumber')} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="IP Address / Hostname" htmlFor="dev-ip" error={form.formState.errors.ipAddress?.message}>
              <Input id="dev-ip" {...form.register('ipAddress')} />
            </FormField>
            <FormField label="Port" htmlFor="dev-port" error={form.formState.errors.port?.message}>
              <Input
                id="dev-port"
                type="number"
                step="1"
                {...form.register('port', {
                  setValueAs: (value: string) => (value === '' ? undefined : Number(value)),
                })}
              />
            </FormField>
          </div>
          <FormField label="Connection Mode" htmlFor="dev-connection-mode" required>
            <Select id="dev-connection-mode" {...form.register('connectionMode')}>
              {ATTENDANCE_CONNECTION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {CONNECTION_MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Notes" htmlFor="dev-notes" error={form.formState.errors.notes?.message}>
            <Textarea id="dev-notes" {...form.register('notes')} />
          </FormField>
          {saveMutation.isError ? (
            <ErrorAlert message={errorMessage(saveMutation.error, 'Failed to save attendance device.')} />
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setFormState(null)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </form>
      </FormModal>

      <ConfirmDialog
        open={deactivateTarget !== null}
        title="Deactivate attendance device?"
        description={`"${deactivateTarget?.name ?? ''}" will be marked inactive. This does not delete any data.`}
        confirmLabel="Deactivate"
        isLoading={deactivateMutation.isPending}
        onConfirm={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
