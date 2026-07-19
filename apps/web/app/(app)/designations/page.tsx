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
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/client';
import {
  createDesignation,
  deactivateDesignation,
  listDesignations,
  updateDesignation,
  type Designation,
} from '@/lib/api/designations';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';

const designationFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  code: z.string().max(50).optional().or(z.literal('')),
  description: z.string().max(1000).optional().or(z.literal('')),
});

type DesignationFormValues = z.infer<typeof designationFormSchema>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function DesignationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'designations.read');
  const canCreate = hasPermission(user, 'designations.create');
  const canUpdate = hasPermission(user, 'designations.update');
  const canDeactivate = hasPermission(user, 'designations.disable');

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [formState, setFormState] = React.useState<{ mode: 'create' | 'edit'; designation: Designation | null } | null>(
    null,
  );
  const [deactivateTarget, setDeactivateTarget] = React.useState<Designation | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['designations', { page, search }],
    queryFn: () => listDesignations({ page, limit: 20, search: search || undefined }),
    enabled: canRead,
    placeholderData: (previous) => previous,
  });

  const form = useForm<DesignationFormValues>({
    resolver: zodResolver(designationFormSchema),
    defaultValues: { title: '', code: '', description: '' },
  });

  function openCreateForm() {
    form.reset({ title: '', code: '', description: '' });
    setFormState({ mode: 'create', designation: null });
  }

  function openEditForm(designation: Designation) {
    form.reset({
      title: designation.title,
      code: designation.code ?? '',
      description: designation.description ?? '',
    });
    setFormState({ mode: 'edit', designation });
  }

  const saveMutation = useMutation({
    mutationFn: (values: DesignationFormValues) => {
      const input = {
        title: values.title,
        code: values.code || undefined,
        description: values.description || undefined,
      };
      return formState?.mode === 'edit' && formState.designation
        ? updateDesignation(formState.designation.id, input)
        : createDesignation(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['designations'] });
      setSuccessMessage(formState?.mode === 'edit' ? 'Designation updated.' : 'Designation created.');
      setFormState(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateDesignation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['designations'] });
      setSuccessMessage('Designation deactivated.');
      setDeactivateTarget(null);
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const columns: DataTableColumn<Designation>[] = [
    { key: 'title', header: 'Title', render: (row) => row.title },
    { key: 'code', header: 'Code', render: (row) => row.code ?? '—' },
    { key: 'description', header: 'Description', render: (row) => row.description ?? '—' },
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
          <h1 className="text-2xl font-semibold text-foreground">Designations</h1>
          <p className="text-sm text-muted-foreground">Job titles and designation management.</p>
        </div>
        {canCreate ? (
          <Button onClick={openCreateForm}>
            <Plus className="h-4 w-4" />
            New Designation
          </Button>
        ) : null}
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {listQuery.isError ? <ErrorAlert message={errorMessage(listQuery.error, 'Failed to load designations.')} /> : null}

      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder="Search designations…"
      />

      <DataTable
        columns={columns}
        data={listQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        isLoading={listQuery.isLoading}
        emptyMessage="No designations found."
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
        title={formState?.mode === 'edit' ? 'Edit Designation' : 'New Designation'}
        onClose={() => setFormState(null)}
      >
        <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="flex flex-col gap-4" noValidate>
          <FormField label="Title" htmlFor="desig-title" required error={form.formState.errors.title?.message}>
            <Input id="desig-title" {...form.register('title')} />
          </FormField>
          <FormField label="Code" htmlFor="desig-code" error={form.formState.errors.code?.message}>
            <Input id="desig-code" {...form.register('code')} />
          </FormField>
          <FormField label="Description" htmlFor="desig-description" error={form.formState.errors.description?.message}>
            <Textarea id="desig-description" {...form.register('description')} />
          </FormField>
          {saveMutation.isError ? (
            <ErrorAlert message={errorMessage(saveMutation.error, 'Failed to save designation.')} />
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
        title="Deactivate designation?"
        description={`"${deactivateTarget?.title ?? ''}" will be marked inactive. This does not delete any data.`}
        confirmLabel="Deactivate"
        isLoading={deactivateMutation.isPending}
        onConfirm={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
