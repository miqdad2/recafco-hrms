import { authorizedRequest } from './client';

export interface ResetPasswordInput {
  temporaryPassword?: string | undefined;
}

export interface ResetPasswordResult {
  user: { id: string; username: string; employeeId: string | null; status: string; mustChangePassword: boolean };
  temporaryPassword: string;
}

export function resetUserPassword(userId: string, input: ResetPasswordInput = {}): Promise<ResetPasswordResult> {
  return authorizedRequest<ResetPasswordResult>(`/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
