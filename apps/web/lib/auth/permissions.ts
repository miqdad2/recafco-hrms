import type { CurrentUserProfile } from '@/lib/api/client';
import { ADMIN_NAV_PERMISSIONS } from '@/lib/routes';

export function hasPermission(user: CurrentUserProfile | null, code: string): boolean {
  return user?.permissions.includes(code) ?? false;
}

export function hasAnyPermission(user: CurrentUserProfile | null, codes: string[]): boolean {
  if (!user) {
    return false;
  }
  return codes.some((code) => user.permissions.includes(code));
}

/**
 * True if the user holds any permission that unlocks an admin-only nav item — the same test
 * the sidebar and Dashboard use to decide between admin navigation/content and the employee
 * self-service navigation/content. A plain EMPLOYEE-role user holds none of these.
 */
export function isAdminUser(user: CurrentUserProfile | null): boolean {
  return hasAnyPermission(user, ADMIN_NAV_PERMISSIONS);
}
