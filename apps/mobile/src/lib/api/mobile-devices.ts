import { authorizedRequest } from './client';

export type MobilePlatform = 'ANDROID' | 'IOS' | 'UNKNOWN';

export type MobileDeviceStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'BLOCKED' | 'DEACTIVATED';

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
  blockedAt: string | null;
  blockReason: string | null;
  registeredAt: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterMobileDeviceInput {
  deviceIdentifier: string;
  platform: MobilePlatform;
  deviceName?: string | undefined;
  manufacturer?: string | undefined;
  model?: string | undefined;
  osVersion?: string | undefined;
  appVersion?: string | undefined;
}

export function registerMobileDevice(input: RegisterMobileDeviceInput): Promise<MobileDevice> {
  return authorizedRequest<MobileDevice>('/mobile-devices/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getMyMobileDevices(): Promise<MobileDevice[]> {
  return authorizedRequest<MobileDevice[]>('/mobile-devices/me');
}
