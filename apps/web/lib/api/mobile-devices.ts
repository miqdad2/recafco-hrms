import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';

export type MobilePlatform = 'ANDROID' | 'IOS' | 'UNKNOWN';
export const MOBILE_PLATFORMS: MobilePlatform[] = ['ANDROID', 'IOS', 'UNKNOWN'];

export type MobileDeviceStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'BLOCKED' | 'DEACTIVATED';
export const MOBILE_DEVICE_STATUSES: MobileDeviceStatus[] = [
  'PENDING_APPROVAL',
  'APPROVED',
  'BLOCKED',
  'DEACTIVATED',
];

export interface MobileDevice {
  id: string;
  employeeId: string;
  deviceIdentifier: string;
  platform: MobilePlatform;
  deviceName: string | null;
  manufacturer: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  status: MobileDeviceStatus;
  isPrimary: boolean;
  approvedAt: string | null;
  approvedByUserId: string | null;
  blockedAt: string | null;
  blockedByUserId: string | null;
  blockReason: string | null;
  registeredAt: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListMobileDevicesParams {
  page?: number;
  limit?: number;
  search?: string | undefined;
  status?: MobileDeviceStatus | undefined;
  platform?: MobilePlatform | undefined;
  employeeId?: string | undefined;
  isPrimary?: boolean | undefined;
}

export interface UpdateMobileDeviceInput {
  deviceName?: string | undefined;
  manufacturer?: string | undefined;
  model?: string | undefined;
  osVersion?: string | undefined;
  appVersion?: string | undefined;
}

export function listMobileDevices(params: ListMobileDevicesParams = {}): Promise<PaginatedResult<MobileDevice>> {
  return authorizedRequest<PaginatedResult<MobileDevice>>(`/mobile-devices${buildQueryString(params)}`);
}

export function getMobileDevice(id: string): Promise<MobileDevice> {
  return authorizedRequest<MobileDevice>(`/mobile-devices/${id}`);
}

/** Not used by the admin screen — kept for reuse by a future self-service page. */
export function getMyMobileDevices(): Promise<MobileDevice[]> {
  return authorizedRequest<MobileDevice[]>('/mobile-devices/me');
}

export function approveMobileDevice(id: string, isPrimary?: boolean): Promise<MobileDevice> {
  return authorizedRequest<MobileDevice>(`/mobile-devices/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ isPrimary }),
  });
}

export function blockMobileDevice(id: string, reason: string): Promise<MobileDevice> {
  return authorizedRequest<MobileDevice>(`/mobile-devices/${id}/block`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function resetMobileDevice(id: string): Promise<MobileDevice> {
  return authorizedRequest<MobileDevice>(`/mobile-devices/${id}/reset`, { method: 'POST' });
}

export function updateMobileDevice(id: string, input: UpdateMobileDeviceInput): Promise<MobileDevice> {
  return authorizedRequest<MobileDevice>(`/mobile-devices/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}
