'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { ErrorAlert } from '@/components/admin/error-alert';
import { FormField } from '@/components/admin/form-field';
import { FormModal } from '@/components/admin/form-modal';
import { Spinner } from '@/components/admin/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, changePassword } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';

interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Mounted only while `open` (see the wrapper below), so every field/success-state resets
 * naturally on each fresh mount — no reset-on-open effect needed.
 */
function ChangePasswordModalContent({ onClose }: { onClose: () => void }) {
  const { updateUser } = useAuth();
  const [successMessage, setSuccessMessage] = React.useState(false);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordFormValues>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: ChangePasswordFormValues) => changePassword(values),
    onSuccess: () => {
      updateUser({ mustChangePassword: false, passwordChangedAt: new Date().toISOString() });
      setSuccessMessage(true);
      reset();
    },
  });

  return (
    <FormModal open title="Change Password" onClose={onClose}>
      {successMessage ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-success">Password changed successfully.</p>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormField label="Current Password" htmlFor="current-password" required error={errors.currentPassword?.message}>
            <Controller
              control={control}
              name="currentPassword"
              rules={{ required: 'Current password is required' }}
              render={({ field }) => <Input id="current-password" type="password" {...field} />}
            />
          </FormField>
          <FormField label="New Password" htmlFor="new-password" required error={errors.newPassword?.message}>
            <Controller
              control={control}
              name="newPassword"
              rules={{ required: 'New password is required', minLength: { value: 8, message: 'At least 8 characters' } }}
              render={({ field }) => <Input id="new-password" type="password" {...field} />}
            />
          </FormField>
          <FormField label="Confirm New Password" htmlFor="confirm-password" required error={errors.confirmPassword?.message}>
            <Controller
              control={control}
              name="confirmPassword"
              rules={{ required: 'Please confirm the new password' }}
              render={({ field }) => <Input id="confirm-password" type="password" {...field} />}
            />
          </FormField>
          {mutation.isError ? <ErrorAlert message={errorMessage(mutation.error, 'Failed to change password.')} /> : null}
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
                'Change Password'
              )}
            </Button>
          </div>
        </form>
      )}
    </FormModal>
  );
}

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) {
    return null;
  }
  return <ChangePasswordModalContent onClose={onClose} />;
}
