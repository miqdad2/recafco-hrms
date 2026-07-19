'use client';

import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
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
import { StatusBadge, type BadgeTone } from '@/components/ui/status-badge';
import { ApiError } from '@/lib/api/client';
import { listDepartments } from '@/lib/api/departments';
import { listDesignations } from '@/lib/api/designations';
import {
  createEmployee,
  createEmployeeUserAccount,
  EMPLOYMENT_TYPES,
  listEmployees,
  terminateEmployee,
  UPDATABLE_EMPLOYEE_STATUSES,
  updateEmployee,
  type Employee,
  type EmployeeStatus,
} from '@/lib/api/employees';
import { resetUserPassword } from '@/lib/api/users';
import { listWorkLocations } from '@/lib/api/work-locations';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission } from '@/lib/auth/permissions';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  TEMPORARY: 'Temporary',
};

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ON_LEAVE: 'On Leave',
  RESIGNED: 'Resigned',
  TERMINATED: 'Terminated',
};

const STATUS_TONES: Record<EmployeeStatus, BadgeTone> = {
  ACTIVE: 'success',
  INACTIVE: 'muted',
  ON_LEAVE: 'info',
  RESIGNED: 'muted',
  TERMINATED: 'error',
};

const optionalString = z.string().max(500).optional().or(z.literal(''));

const createEmployeeFormSchema = z.object({
  employeeCode: z.string().min(1, 'Employee code is required').max(50),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email address').max(200).optional().or(z.literal('')),
  phone: optionalString,
  civilId: optionalString,
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY']),
  departmentId: optionalString,
  designationId: optionalString,
  workLocationId: optionalString,
  hireDate: z.string().min(1, 'Hire date is required'),
});

const editEmployeeFormSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email address').max(200).optional().or(z.literal('')),
  phone: optionalString,
  civilId: optionalString,
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY']),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'RESIGNED']),
  departmentId: optionalString,
  designationId: optionalString,
  workLocationId: optionalString,
});

type CreateEmployeeFormValues = z.infer<typeof createEmployeeFormSchema>;
type EditEmployeeFormValues = z.infer<typeof editEmployeeFormSchema>;

interface DropdownOptions {
  departments: { id: string; name: string }[];
  designations: { id: string; title: string }[];
  workLocations: { id: string; name: string }[];
}

function RelationSelects({
  departmentRegister,
  designationRegister,
  workLocationRegister,
  options,
}: {
  departmentRegister: UseFormRegisterReturn;
  designationRegister: UseFormRegisterReturn;
  workLocationRegister: UseFormRegisterReturn;
  options: DropdownOptions;
}) {
  return (
    <>
      <FormField label="Department" htmlFor="emp-department">
        <Select id="emp-department" {...departmentRegister}>
          <option value="">— None —</option>
          {options.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Designation" htmlFor="emp-designation">
        <Select id="emp-designation" {...designationRegister}>
          <option value="">— None —</option>
          {options.designations.map((designation) => (
            <option key={designation.id} value={designation.id}>
              {designation.title}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Work Location" htmlFor="emp-work-location">
        <Select id="emp-work-location" {...workLocationRegister}>
          <option value="">— None —</option>
          {options.workLocations.map((workLocation) => (
            <option key={workLocation.id} value={workLocation.id}>
              {workLocation.name}
            </option>
          ))}
        </Select>
      </FormField>
    </>
  );
}

function CreateEmployeeModal({
  open,
  options,
  onClose,
  onSuccess,
}: {
  open: boolean;
  options: DropdownOptions;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const form = useForm<CreateEmployeeFormValues>({
    resolver: zodResolver(createEmployeeFormSchema),
    defaultValues: {
      employeeCode: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      civilId: '',
      employmentType: 'FULL_TIME',
      departmentId: '',
      designationId: '',
      workLocationId: '',
      hireDate: '',
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = useMutation({
    mutationFn: (values: CreateEmployeeFormValues) =>
      createEmployee({
        employeeCode: values.employeeCode,
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email || undefined,
        phone: values.phone || undefined,
        civilId: values.civilId || undefined,
        employmentType: values.employmentType,
        departmentId: values.departmentId || undefined,
        designationId: values.designationId || undefined,
        workLocationId: values.workLocationId || undefined,
        hireDate: values.hireDate,
      }),
    onSuccess,
  });

  return (
    <FormModal open={open} title="New Employee" onClose={onClose}>
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Employee Code" htmlFor="emp-code" required error={form.formState.errors.employeeCode?.message}>
            <Input id="emp-code" {...form.register('employeeCode')} />
          </FormField>
          <FormField label="Hire Date" htmlFor="emp-hire-date" required error={form.formState.errors.hireDate?.message}>
            <Input id="emp-hire-date" type="date" {...form.register('hireDate')} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="First Name" htmlFor="emp-first-name" required error={form.formState.errors.firstName?.message}>
            <Input id="emp-first-name" {...form.register('firstName')} />
          </FormField>
          <FormField label="Last Name" htmlFor="emp-last-name" required error={form.formState.errors.lastName?.message}>
            <Input id="emp-last-name" {...form.register('lastName')} />
          </FormField>
        </div>
        <FormField label="Email" htmlFor="emp-email" error={form.formState.errors.email?.message}>
          <Input id="emp-email" type="email" {...form.register('email')} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Phone" htmlFor="emp-phone" error={form.formState.errors.phone?.message}>
            <Input id="emp-phone" {...form.register('phone')} />
          </FormField>
          <FormField label="Civil ID" htmlFor="emp-civil-id" error={form.formState.errors.civilId?.message}>
            <Input id="emp-civil-id" {...form.register('civilId')} />
          </FormField>
        </div>
        <FormField label="Employment Type" htmlFor="emp-employment-type" required>
          <Select id="emp-employment-type" {...form.register('employmentType')}>
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EMPLOYMENT_TYPE_LABELS[type] ?? type}
              </option>
            ))}
          </Select>
        </FormField>
        <RelationSelects
          departmentRegister={form.register('departmentId')}
          designationRegister={form.register('designationId')}
          workLocationRegister={form.register('workLocationId')}
          options={options}
        />
        {mutation.isError ? <ErrorAlert message={errorMessage(mutation.error, 'Failed to create employee.')} /> : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
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
  );
}

function EditEmployeeModal({
  employee,
  options,
  onClose,
  onSuccess,
}: {
  employee: Employee | null;
  options: DropdownOptions;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const form = useForm<EditEmployeeFormValues>({
    resolver: zodResolver(editEmployeeFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      civilId: '',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      departmentId: '',
      designationId: '',
      workLocationId: '',
    },
  });

  React.useEffect(() => {
    if (employee) {
      form.reset({
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email ?? '',
        phone: employee.phone ?? '',
        civilId: employee.civilId ?? '',
        employmentType: employee.employmentType,
        status: employee.status === 'TERMINATED' ? 'ACTIVE' : employee.status,
        departmentId: employee.departmentId ?? '',
        designationId: employee.designationId ?? '',
        workLocationId: employee.workLocationId ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee]);

  const mutation = useMutation({
    mutationFn: (values: EditEmployeeFormValues) => {
      if (!employee) {
        throw new Error('No employee selected');
      }
      return updateEmployee(employee.id, {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email || undefined,
        phone: values.phone || undefined,
        civilId: values.civilId || undefined,
        employmentType: values.employmentType,
        status: values.status,
        departmentId: values.departmentId || undefined,
        designationId: values.designationId || undefined,
        workLocationId: values.workLocationId || undefined,
      });
    },
    onSuccess,
  });

  return (
    <FormModal open={employee !== null} title="Edit Employee" onClose={onClose}>
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="First Name" htmlFor="edit-emp-first-name" required error={form.formState.errors.firstName?.message}>
            <Input id="edit-emp-first-name" {...form.register('firstName')} />
          </FormField>
          <FormField label="Last Name" htmlFor="edit-emp-last-name" required error={form.formState.errors.lastName?.message}>
            <Input id="edit-emp-last-name" {...form.register('lastName')} />
          </FormField>
        </div>
        <FormField label="Email" htmlFor="edit-emp-email" error={form.formState.errors.email?.message}>
          <Input id="edit-emp-email" type="email" {...form.register('email')} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Phone" htmlFor="edit-emp-phone" error={form.formState.errors.phone?.message}>
            <Input id="edit-emp-phone" {...form.register('phone')} />
          </FormField>
          <FormField label="Civil ID" htmlFor="edit-emp-civil-id" error={form.formState.errors.civilId?.message}>
            <Input id="edit-emp-civil-id" {...form.register('civilId')} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Employment Type" htmlFor="edit-emp-employment-type" required>
            <Select id="edit-emp-employment-type" {...form.register('employmentType')}>
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EMPLOYMENT_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Status" htmlFor="edit-emp-status" required>
            <Select id="edit-emp-status" {...form.register('status')}>
              {UPDATABLE_EMPLOYEE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <RelationSelects
          departmentRegister={form.register('departmentId')}
          designationRegister={form.register('designationId')}
          workLocationRegister={form.register('workLocationId')}
          options={options}
        />
        {mutation.isError ? <ErrorAlert message={errorMessage(mutation.error, 'Failed to update employee.')} /> : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
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
  );
}

interface CredentialResult {
  username: string;
  temporaryPassword: string;
}

function CredentialRevealModal({ result, onClose }: { result: CredentialResult | null; onClose: () => void }) {
  // Derived from a comparison rather than reset via an effect: a freshly-issued `result`
  // never matches `copiedFor`, so "Copied!" naturally reverts for each new credential
  // without needing a `useEffect` to explicitly clear it.
  const [copiedFor, setCopiedFor] = React.useState<string | null>(null);

  if (!result) {
    return null;
  }

  const copied = copiedFor === result.temporaryPassword;

  const handleCopy = () => {
    void navigator.clipboard.writeText(result.temporaryPassword).then(() => {
      setCopiedFor(result.temporaryPassword);
    });
  };

  return (
    <FormModal open={result !== null} title="Temporary Password" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Copy this password now. It will not be shown again.
        </p>
        <div className="rounded-md border border-border bg-surface-muted px-4 py-3">
          <p className="text-xs text-muted-foreground">Username</p>
          <p className="font-mono text-sm text-foreground">{result.username}</p>
          <p className="mt-2 text-xs text-muted-foreground">Temporary Password</p>
          <p className="font-mono text-base font-semibold text-foreground">{result.temporaryPassword}</p>
        </div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy Password'}
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </FormModal>
  );
}

function CreateLoginModal({
  employee,
  onClose,
  onSuccess,
}: {
  employee: Employee | null;
  onClose: () => void;
  onSuccess: (result: CredentialResult) => void;
}) {
  // Lazily initialized from `employee` at mount time rather than synced via an effect — the
  // parent remounts this component (via a `key` keyed on the employee id) each time a
  // different employee is targeted, so this initializer always runs against the right employee.
  const [temporaryPassword, setTemporaryPassword] = React.useState(() =>
    employee ? `Recafco@${employee.employeeCode}` : '',
  );

  const mutation = useMutation({
    mutationFn: () => {
      if (!employee) {
        throw new Error('No employee selected');
      }
      return createEmployeeUserAccount(employee.id, { temporaryPassword: temporaryPassword || undefined });
    },
    onSuccess: (result) => onSuccess({ username: result.user.username, temporaryPassword: result.temporaryPassword }),
  });

  return (
    <FormModal open={employee !== null} title="Create Login Account" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormField label="Username" htmlFor="create-login-username">
          <Input id="create-login-username" value={employee?.employeeCode ?? ''} disabled readOnly />
        </FormField>
        <FormField label="Temporary Password" htmlFor="create-login-password">
          <Input
            id="create-login-password"
            value={temporaryPassword}
            onChange={(event) => setTemporaryPassword(event.target.value)}
          />
        </FormField>
        <p className="text-sm text-muted-foreground">
          This temporary password will be shown once. Employee should change it after login.
        </p>
        {mutation.isError ? (
          <ErrorAlert message={errorMessage(mutation.error, 'Failed to create login account.')} />
        ) : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Spinner /> Creating…
              </>
            ) : (
              'Create Login'
            )}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}

function ResetPasswordModal({
  employee,
  onClose,
  onSuccess,
}: {
  employee: Employee | null;
  onClose: () => void;
  onSuccess: (result: CredentialResult) => void;
}) {
  // See CreateLoginModal above: lazily initialized, reset via the parent's `key` remount
  // instead of an effect.
  const [temporaryPassword, setTemporaryPassword] = React.useState(() =>
    employee ? `Recafco@${employee.employeeCode}` : '',
  );

  const mutation = useMutation({
    mutationFn: () => {
      if (!employee?.user) {
        throw new Error('No user account selected');
      }
      return resetUserPassword(employee.user.id, { temporaryPassword: temporaryPassword || undefined });
    },
    onSuccess: (result) => onSuccess({ username: result.user.username, temporaryPassword: result.temporaryPassword }),
  });

  return (
    <FormModal open={employee !== null} title="Reset Password" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormField label="Username" htmlFor="reset-password-username">
          <Input id="reset-password-username" value={employee?.employeeCode ?? ''} disabled readOnly />
        </FormField>
        <FormField label="Temporary Password" htmlFor="reset-password-password">
          <Input
            id="reset-password-password"
            value={temporaryPassword}
            onChange={(event) => setTemporaryPassword(event.target.value)}
          />
        </FormField>
        <p className="text-sm text-muted-foreground">
          This temporary password will be shown once. Employee should change it after login.
        </p>
        {mutation.isError ? (
          <ErrorAlert message={errorMessage(mutation.error, 'Failed to reset password.')} />
        ) : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <Spinner /> Resetting…
              </>
            ) : (
              'Reset Password'
            )}
          </Button>
        </div>
      </form>
    </FormModal>
  );
}

export default function EmployeesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = hasPermission(user, 'employees.read');
  const canCreate = hasPermission(user, 'employees.create');
  const canUpdate = hasPermission(user, 'employees.update');
  const canTerminate = hasPermission(user, 'employees.disable');
  const canCreateUserAccount = hasPermission(user, 'employees.createUserAccount');
  const canResetPassword = hasPermission(user, 'users.resetPassword');

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editEmployee, setEditEmployee] = React.useState<Employee | null>(null);
  const [terminateTarget, setTerminateTarget] = React.useState<Employee | null>(null);
  const [createLoginTarget, setCreateLoginTarget] = React.useState<Employee | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = React.useState<Employee | null>(null);
  const [credentialResult, setCredentialResult] = React.useState<CredentialResult | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['employees', { page, search }],
    queryFn: () => listEmployees({ page, limit: 20, search: search || undefined }),
    enabled: canRead,
    placeholderData: (previous) => previous,
  });

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'dropdown'],
    queryFn: () => listDepartments({ isActive: true, limit: 100 }),
    enabled: canRead && (canCreate || canUpdate),
  });
  const designationsQuery = useQuery({
    queryKey: ['designations', 'dropdown'],
    queryFn: () => listDesignations({ isActive: true, limit: 100 }),
    enabled: canRead && (canCreate || canUpdate),
  });
  const workLocationsQuery = useQuery({
    queryKey: ['work-locations', 'dropdown'],
    queryFn: () => listWorkLocations({ isActive: true, limit: 100 }),
    enabled: canRead && (canCreate || canUpdate),
  });

  const dropdownOptions: DropdownOptions = {
    departments: departmentsQuery.data?.data ?? [],
    designations: designationsQuery.data?.data ?? [],
    workLocations: workLocationsQuery.data?.data ?? [],
  };

  const terminateMutation = useMutation({
    mutationFn: (id: string) => terminateEmployee(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      setSuccessMessage('Employee terminated.');
      setTerminateTarget(null);
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  const columns: DataTableColumn<Employee>[] = [
    { key: 'employeeCode', header: 'Code', render: (row) => row.employeeCode },
    { key: 'fullName', header: 'Name', render: (row) => row.fullName },
    { key: 'department', header: 'Department', render: (row) => row.department?.name ?? '—' },
    { key: 'designation', header: 'Designation', render: (row) => row.designation?.title ?? '—' },
    {
      key: 'employmentType',
      header: 'Employment',
      render: (row) => EMPLOYMENT_TYPE_LABELS[row.employmentType] ?? row.employmentType,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge label={STATUS_LABELS[row.status]} tone={STATUS_TONES[row.status]} />,
    },
    {
      key: 'loginAccount',
      header: 'Login Account',
      render: (row) =>
        row.user ? (
          <div className="flex flex-col gap-1">
            <StatusBadge label="Login account exists" tone="success" />
            {row.user.mustChangePassword ? (
              <span className="text-xs text-muted-foreground">Temporary password not yet changed</span>
            ) : null}
          </div>
        ) : (
          <StatusBadge label="No login account" tone="muted" />
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-2">
          {canUpdate && row.status !== 'TERMINATED' ? (
            <Button variant="outline" size="sm" onClick={() => setEditEmployee(row)}>
              Edit
            </Button>
          ) : null}
          {canCreateUserAccount && !row.user && row.status === 'ACTIVE' ? (
            <Button variant="outline" size="sm" onClick={() => setCreateLoginTarget(row)}>
              Create Login
            </Button>
          ) : null}
          {canResetPassword && row.user ? (
            <Button variant="outline" size="sm" onClick={() => setResetPasswordTarget(row)}>
              Reset Password
            </Button>
          ) : null}
          {canTerminate && row.status !== 'TERMINATED' ? (
            <Button variant="outline" size="sm" onClick={() => setTerminateTarget(row)}>
              Terminate
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
          <h1 className="text-2xl font-semibold text-foreground">Employees</h1>
          <p className="text-sm text-muted-foreground">Employee directory and profile management.</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New Employee
          </Button>
        ) : null}
      </div>

      {successMessage ? <SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /> : null}
      {listQuery.isError ? <ErrorAlert message={errorMessage(listQuery.error, 'Failed to load employees.')} /> : null}

      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder="Search employees…"
      />

      <DataTable
        columns={columns}
        data={listQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        isLoading={listQuery.isLoading}
        emptyMessage="No employees found."
      />

      {listQuery.data ? (
        <PaginationControls
          page={listQuery.data.meta.page}
          totalPages={listQuery.data.meta.totalPages}
          total={listQuery.data.meta.total}
          onPageChange={setPage}
        />
      ) : null}

      <CreateEmployeeModal
        open={createOpen}
        options={dropdownOptions}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ['employees'] });
          setSuccessMessage('Employee created.');
          setCreateOpen(false);
        }}
      />

      <EditEmployeeModal
        employee={editEmployee}
        options={dropdownOptions}
        onClose={() => setEditEmployee(null)}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ['employees'] });
          setSuccessMessage('Employee updated.');
          setEditEmployee(null);
        }}
      />

      <ConfirmDialog
        open={terminateTarget !== null}
        title="Terminate employee?"
        description={`"${terminateTarget?.fullName ?? ''}" will be marked terminated. This does not delete any data and cannot be undone through this screen.`}
        confirmLabel="Terminate"
        isLoading={terminateMutation.isPending}
        onConfirm={() => terminateTarget && terminateMutation.mutate(terminateTarget.id)}
        onCancel={() => setTerminateTarget(null)}
      />

      <CreateLoginModal
        key={createLoginTarget?.id ?? 'none'}
        employee={createLoginTarget}
        onClose={() => setCreateLoginTarget(null)}
        onSuccess={(result) => {
          void queryClient.invalidateQueries({ queryKey: ['employees'] });
          setCreateLoginTarget(null);
          setCredentialResult(result);
        }}
      />

      <ResetPasswordModal
        key={resetPasswordTarget?.id ?? 'none'}
        employee={resetPasswordTarget}
        onClose={() => setResetPasswordTarget(null)}
        onSuccess={(result) => {
          void queryClient.invalidateQueries({ queryKey: ['employees'] });
          setResetPasswordTarget(null);
          setCredentialResult(result);
        }}
      />

      <CredentialRevealModal result={credentialResult} onClose={() => setCredentialResult(null)} />
    </div>
  );
}
