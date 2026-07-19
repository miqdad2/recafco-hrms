import type { CurrentUserProfile } from '@/lib/api/client';

export function hasPermission(user: CurrentUserProfile | null, code: string): boolean {
  return user?.permissions.includes(code) ?? false;
}

export function hasAnyPermission(user: CurrentUserProfile | null, codes: string[]): boolean {
  if (!user) {
    return false;
  }
  return codes.some((code) => user.permissions.includes(code));
}
