'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AccessDenied } from '@/components/admin/access-denied';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { PaginationControls } from '@/components/admin/pagination-controls';
import { ReasonDialog } from '@/components/admin/reason-dialog';
import { SearchInput } from '@/components/admin/search-input';
import { Spinner } from '@/components/admin/spinner';
import { SuccessBanner } from '@/components/admin/success-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import { ApiError } from '@/lib/api/client';
import { getEmployee } from '@/lib/api/employees';
import {
  approveMobileDevice,
  blockMobileDevice,
  listMobileDevices,
  MOBILE_DEVICE_STATUSES,
  MOBILE_PLATFORMS,
  resetMobileDevice,
  updateMobileDevice,
  type MobileDevice,
  type MobileDeviceStatus,
  type MobilePlatform,
} from '@/lib/api/mobile-devices';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const STATUS_LABELS: Record<MobileDeviceStatus, string> = {
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  BLOCKED: 'Blocked',
  DEACTIVATED: 'Deactivated',
};

const STATUS_TONES: Record<MobileDeviceStatus, BadgeTone> = {
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  BLOCKED: 'error',
  DEACTIVATED: 'muted',
};

const PLATFORM_LABELS: Record<MobilePlatform, string> = {
  ANDROID: 'Android',
  IOS: 'iOS',
  UNKNOWN: 'Unknown',
};

const optionalString = (max: number) => z.string().max(max).optional().or(z.literal(''));

const editMetadataSchema = z.object({
  deviceName: optionalString(200),
  manufacturer: optionalString(100),
  model: optionalString(100),
  osVersion: optionalString(50),
  appVersion: optionalString(50),
});

type EditMetadataValues = z.infer<typeof editMetadataSchema>;

export default function MobileDevicesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'mobileDevices.read');
  const canApprove = hasPermission(user, 'mobileDevices.approve');
  const canBlock = hasPermission(user, 'mobileDevices.block');
  const canReset = hasPermission(user, 'mobileDevices.reset');
  const canUpdate = hasPermission(user, 'mobileDevices.update');

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [platformFilter, setPlatformFilter] = React.useState('');
  const [employeeIdFilter, setEmployeeIdFilter] = React.useState('');
  const [primaryFilter, setPrimaryFilter] = React.useState('');
  const [approveTarget, setApproveTarget] = React.useState<MobileDevice | null>(null);
  const [blockTarget, setBlockTarget] = React.useState<MobileDevice | null>(null);
  const [resetTarget, setResetTarget] = React.useState<MobileDevice | null>(null);
  const [editDevice, setEditDevice] = React.useState<MobileDevice | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['mobile-devices', { page, search, statusFilter, platformFilter, employeeIdFilter, primaryFilter }],
    queryFn: () =>
      listMobileDevices({
        page,
        limit: 20,
        search: search || undefined,
        status: (statusFilter || undefined) as MobileDeviceStatus | undefined,
        platform: (platformFilter || undefined) as MobilePlatform | undefined,
        employeeId: employeeIdFilter || undefined,
        isPrimary: primaryFilter === '' ? undefined : primaryFilter === 'true',
      }),
    enabled: canRead,
    placeholderData: (previous) => previous,
  });

  const rows = listQuery.data?.data ?? [];
  const uniqueEmployeeIds = Array.from(new Set(rows.map((row) => row.employeeId)));
  const employeeQueries = useQueries({
    queries: uniqueEmployeeIds.map((employeeId) => ({
      queryKey: ['employees', 'lookup', employeeId],
      queryFn: () => getEmployee(employeeId),
      enabled: canRead,
      staleTime: 60_000,
    })),
  });
  const employeeById = new Map<string, (typeof employeeQueries)[number]['data']>();
  uniqueEmployeeIds.forEach((employeeId, index) => {
    const data = employeeQueries[index]?.data;
    if (data) {
      employeeById.set(employeeId, data);
    }
  });
  function employeeLabel(employeeId: string): string {
    const employee = employeeById.get(employeeId);
    return employee ? `${employee.fullName} (${employee.employeeCode})` : employeeId;
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveMobileDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-devices'] });
      setSuccessMessage('Mobile device approved.');
      setApproveTarget(null);
    },
  });

  const blockMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => blockMobileDevice(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-devices'] });
      setSuccessMessage('Mobile device blocked.');
      setBlockTarget(null);
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => resetMobileDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-devices'] });
      setSuccessMessage('Mobile device reset.');
      setResetTarget(null);
    },
  });

  const editForm = useForm<EditMetadataValues>({
    resolver: zodResolver(editMetadataSchema),
    defaultValues: { deviceName: '', manufacturer: '', model: '', osVersion: '', appVersion: '' },
  });

  React.useEffect(() => {
    if (editDevice) {
      editForm.reset({
        deviceName: editDevice.deviceName ?? '',
        manufacturer: editDevice.manufacturer ?? '',
        model: editDevice.model ?? '',
        osVersion: editDevice.osVersion ?? '',
        appVersion: editDevice.appVersion ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDevice]);

  const editMutation = useMutation({
    mutationFn: (values: EditMetadataValues) => {
      if (!editDevice) {
        throw new Error('No device selected');
      }
      return updateMobileDevice(editDevice.id, {
        deviceName: values.deviceName || undefined,
        manufacturer: values.manufacturer || undefined,
        model: values.model || undefined,
        osVersion: values.osVersion || undefined,
        appVersion: values.appVersion || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-devices'] });
      setSuccessMessage('Mobile device metadata updated.');
      setEditDevice(null);
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const columns: DataTableColumn<MobileDevice>[] = [
    { key: 'employee', header: 'Employee', render: (row) => employeeLabel(row.employeeId) },
    { key: 'deviceIdentifier', header: 'Device', render: (row) => row.deviceName ?? row.deviceIdentifier },
    { key: 'platform', header: 'Platform', render: (row) => PLATFORM_LABELS[row.platform] },
    {
      key: 'primary',
      header: 'Primary',
      render: (row) =>
        row.isPrimary ? (
          <Star className="h-4 w-4 fill-warning text-warning" aria-label="Primary device" />
        ) : (
          <span className="text-subtle-foreground">—</span>
        ),
    },
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
          {canApprove && row.status !== 'APPROVED' && row.status !== 'BLOCKED' ? (
            <Button variant="outline" size="sm" onClick={() => setApproveTarget(row)}>
              Approve
            </Button>
          ) : null}
          {canBlock && row.status !== 'BLOCKED' ? (
            <Button variant="outline" size="sm" onClick={() => setBlockTarget(row)}>
              Block
            </Button>
          ) : null}
          {canReset && row.status !== 'DEACTIVATED' ? (
            <Button variant="outline" size="sm" onClick={() => setResetTarget(row)}>
              Reset
            </Button>
          ) : null}
          {canUpdate ? (
            <Button variant="outline" size="sm" onClick={() => setEditDevice(row)}>
              Edit
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Mobile Devices</h1>
        <p className="text-sm text-muted-foreground">Employee mobile device bindings and approvals.</p>
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {listQuery.isError ? <ErrorAlert message={errorMessage(listQuery.error, 'Failed to load mobile devices.')} /> : null}

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
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
          }}
          className="w-48"
        >
          <option value="">All statuses</option>
          {MOBILE_DEVICE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
        <Select
          value={platformFilter}
          onChange={(event) => {
            setPlatformFilter(event.target.value);
            setPage(1);
          }}
          className="w-36"
        >
          <option value="">All platforms</option>
          {MOBILE_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {PLATFORM_LABELS[platform]}
            </option>
          ))}
        </Select>
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
          value={primaryFilter}
          onChange={(event) => {
            setPrimaryFilter(event.target.value);
            setPage(1);
          }}
          className="w-36"
        >
          <option value="">Primary: any</option>
          <option value="true">Primary only</option>
          <option value="false">Non-primary only</option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        isLoading={listQuery.isLoading}
        emptyMessage="No mobile devices found."
      />

      {listQuery.data ? (
        <PaginationControls
          page={listQuery.data.meta.page}
          totalPages={listQuery.data.meta.totalPages}
          total={listQuery.data.meta.total}
          onPageChange={setPage}
        />
      ) : null}

      <ConfirmDialog
        open={approveTarget !== null}
        title="Approve mobile device?"
        description={`This device will become the employee's primary approved device for mobile attendance.${
          approveTarget ? ` (${approveTarget.deviceIdentifier})` : ''
        }`}
        confirmLabel="Approve"
        isLoading={approveMutation.isPending}
        onConfirm={() => approveTarget && approveMutation.mutate(approveTarget.id)}
        onCancel={() => setApproveTarget(null)}
      />

      <ReasonDialog
        key={blockTarget?.id ?? 'closed'}
        open={blockTarget !== null}
        title="Block mobile device?"
        description={`"${blockTarget?.deviceIdentifier ?? ''}" will be blocked from submitting mobile attendance punches.`}
        confirmLabel="Block"
        isLoading={blockMutation.isPending}
        error={blockMutation.isError ? errorMessage(blockMutation.error, 'Failed to block device.') : undefined}
        onConfirm={(reason) => blockTarget && blockMutation.mutate({ id: blockTarget.id, reason })}
        onCancel={() => setBlockTarget(null)}
      />

      <ConfirmDialog
        open={resetTarget !== null}
        title="Reset mobile device?"
        description={`"${resetTarget?.deviceIdentifier ?? ''}" will be deactivated and its primary flag cleared. It can be re-approved later.`}
        confirmLabel="Reset"
        isLoading={resetMutation.isPending}
        onConfirm={() => resetTarget && resetMutation.mutate(resetTarget.id)}
        onCancel={() => setResetTarget(null)}
      />

      <FormModal open={editDevice !== null} title="Edit Device Metadata" onClose={() => setEditDevice(null)}>
        <form
          onSubmit={editForm.handleSubmit((values) => editMutation.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormField label="Device Name" htmlFor="mdev-name" error={editForm.formState.errors.deviceName?.message}>
            <Input id="mdev-name" {...editForm.register('deviceName')} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Manufacturer" htmlFor="mdev-manufacturer" error={editForm.formState.errors.manufacturer?.message}>
              <Input id="mdev-manufacturer" {...editForm.register('manufacturer')} />
            </FormField>
            <FormField label="Model" htmlFor="mdev-model" error={editForm.formState.errors.model?.message}>
              <Input id="mdev-model" {...editForm.register('model')} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="OS Version" htmlFor="mdev-os-version" error={editForm.formState.errors.osVersion?.message}>
              <Input id="mdev-os-version" {...editForm.register('osVersion')} />
            </FormField>
            <FormField label="App Version" htmlFor="mdev-app-version" error={editForm.formState.errors.appVersion?.message}>
              <Input id="mdev-app-version" {...editForm.register('appVersion')} />
            </FormField>
          </div>
          {editMutation.isError ? (
            <ErrorAlert message={errorMessage(editMutation.error, 'Failed to update device metadata.')} />
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setEditDevice(null)} disabled={editMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={editMutation.isPending}>
              {editMutation.isPending ? (
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
    </div>
  );
}
