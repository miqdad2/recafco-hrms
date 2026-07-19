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
import { ApiError } from '@/lib/api/client';
import {
  createWorkLocation,
  deactivateWorkLocation,
  listWorkLocations,
  updateWorkLocation,
  WORK_LOCATION_TYPES,
  type WorkLocation,
} from '@/lib/api/work-locations';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';

function requiredNumberInRange(label: string, min: number, max: number) {
  return z
    .number()
    .refine((val) => !Number.isNaN(val), `${label} is required`)
    .refine((val) => val >= min && val <= max, `${label} must be between ${min} and ${max}`);
}

const workLocationFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  code: z.string().min(1, 'Code is required').max(50),
  type: z.enum(['OFFICE', 'FACTORY', 'WAREHOUSE', 'PROJECT_SITE']),
  address: z.string().max(500).optional().or(z.literal('')),
  latitude: requiredNumberInRange('Latitude', -90, 90),
  longitude: requiredNumberInRange('Longitude', -180, 180),
  geofenceRadiusMeters: z
    .number()
    .int('Radius must be a whole number')
    .positive('Radius must be positive')
    .max(5000, 'Radius must be 5000 or less')
    .optional(),
});

type WorkLocationFormValues = z.infer<typeof workLocationFormSchema>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const TYPE_LABELS: Record<string, string> = {
  OFFICE: 'Office',
  FACTORY: 'Factory',
  WAREHOUSE: 'Warehouse',
  PROJECT_SITE: 'Project Site',
};

export default function WorkLocationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'workLocations.read');
  const canCreate = hasPermission(user, 'workLocations.create');
  const canUpdate = hasPermission(user, 'workLocations.update');
  const canDeactivate = hasPermission(user, 'workLocations.disable');

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('');
  const [formState, setFormState] = React.useState<{ mode: 'create' | 'edit'; workLocation: WorkLocation | null } | null>(
    null,
  );
  const [deactivateTarget, setDeactivateTarget] = React.useState<WorkLocation | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['work-locations', { page, search, typeFilter }],
    queryFn: () =>
      listWorkLocations({
        page,
        limit: 20,
        search: search || undefined,
        type: (typeFilter || undefined) as WorkLocation['type'] | undefined,
      }),
    enabled: canRead,
    placeholderData: (previous) => previous,
  });

  const form = useForm<WorkLocationFormValues>({
    resolver: zodResolver(workLocationFormSchema),
    defaultValues: { name: '', code: '', type: 'OFFICE', address: '', latitude: 0, longitude: 0 },
  });

  function openCreateForm() {
    form.reset({ name: '', code: '', type: 'OFFICE', address: '', latitude: 0, longitude: 0, geofenceRadiusMeters: undefined });
    setFormState({ mode: 'create', workLocation: null });
  }

  function openEditForm(workLocation: WorkLocation) {
    form.reset({
      name: workLocation.name,
      code: workLocation.code,
      type: workLocation.type,
      address: workLocation.address ?? '',
      latitude: workLocation.latitude,
      longitude: workLocation.longitude,
      geofenceRadiusMeters: workLocation.geofenceRadiusMeters,
    });
    setFormState({ mode: 'edit', workLocation });
  }

  const saveMutation = useMutation({
    mutationFn: (values: WorkLocationFormValues) => {
      const input = {
        name: values.name,
        code: values.code,
        type: values.type,
        address: values.address || undefined,
        latitude: values.latitude,
        longitude: values.longitude,
        geofenceRadiusMeters: values.geofenceRadiusMeters,
      };
      return formState?.mode === 'edit' && formState.workLocation
        ? updateWorkLocation(formState.workLocation.id, input)
        : createWorkLocation(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['work-locations'] });
      setSuccessMessage(formState?.mode === 'edit' ? 'Work location updated.' : 'Work location created.');
      setFormState(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateWorkLocation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['work-locations'] });
      setSuccessMessage('Work location deactivated.');
      setDeactivateTarget(null);
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const columns: DataTableColumn<WorkLocation>[] = [
    { key: 'name', header: 'Name', render: (row) => row.name },
    { key: 'code', header: 'Code', render: (row) => row.code },
    { key: 'type', header: 'Type', render: (row) => TYPE_LABELS[row.type] ?? row.type },
    {
      key: 'coordinates',
      header: 'Coordinates',
      render: (row) => `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`,
    },
    { key: 'radius', header: 'Radius (m)', render: (row) => row.geofenceRadiusMeters },
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
        <div className="flex justify-end gap-2">
          {canUpdate ? (
            <Button variant="outline" size="sm" onClick={() => openEditForm(row)}>
              Edit
            </Button>
          ) : null}
          {canDeactivate && row.isActive ? (
            <Button variant="outline" size="sm" onClick={() => setDeactivateTarget(row)}>
              Deactivate
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
          <h1 className="text-2xl font-semibold text-foreground">Work Locations</h1>
          <p className="text-sm text-muted-foreground">Offices, factories, and project site geofences.</p>
        </div>
        {canCreate ? (
          <Button onClick={openCreateForm}>
            <Plus className="h-4 w-4" />
            New Work Location
          </Button>
        ) : null}
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {listQuery.isError ? <ErrorAlert message={errorMessage(listQuery.error, 'Failed to load work locations.')} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search work locations…"
        />
        <Select
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value);
            setPage(1);
          }}
          className="w-48"
        >
          <option value="">All types</option>
          {WORK_LOCATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type] ?? type}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={listQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        isLoading={listQuery.isLoading}
        emptyMessage="No work locations found."
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
        title={formState?.mode === 'edit' ? 'Edit Work Location' : 'New Work Location'}
        onClose={() => setFormState(null)}
      >
        <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="flex flex-col gap-4" noValidate>
          <FormField label="Name" htmlFor="wl-name" required error={form.formState.errors.name?.message}>
            <Input id="wl-name" {...form.register('name')} />
          </FormField>
          <FormField label="Code" htmlFor="wl-code" required error={form.formState.errors.code?.message}>
            <Input id="wl-code" {...form.register('code')} />
          </FormField>
          <FormField label="Type" htmlFor="wl-type" required error={form.formState.errors.type?.message}>
            <Select id="wl-type" {...form.register('type')}>
              {WORK_LOCATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Address" htmlFor="wl-address" error={form.formState.errors.address?.message}>
            <Input id="wl-address" {...form.register('address')} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Latitude" htmlFor="wl-latitude" required error={form.formState.errors.latitude?.message}>
              <Input id="wl-latitude" type="number" step="any" {...form.register('latitude', { valueAsNumber: true })} />
            </FormField>
            <FormField label="Longitude" htmlFor="wl-longitude" required error={form.formState.errors.longitude?.message}>
              <Input id="wl-longitude" type="number" step="any" {...form.register('longitude', { valueAsNumber: true })} />
            </FormField>
          </div>
          <FormField
            label="Geofence radius (meters)"
            htmlFor="wl-radius"
            error={form.formState.errors.geofenceRadiusMeters?.message}
          >
            <Input
              id="wl-radius"
              type="number"
              step="1"
              placeholder="Default: 100"
              {...form.register('geofenceRadiusMeters', {
                setValueAs: (value: string) => (value === '' ? undefined : Number(value)),
              })}
            />
          </FormField>
          {saveMutation.isError ? (
            <ErrorAlert message={errorMessage(saveMutation.error, 'Failed to save work location.')} />
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
        title="Deactivate work location?"
        description={`"${deactivateTarget?.name ?? ''}" will be marked inactive. This does not delete any data.`}
        confirmLabel="Deactivate"
        isLoading={deactivateMutation.isPending}
        onConfirm={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
