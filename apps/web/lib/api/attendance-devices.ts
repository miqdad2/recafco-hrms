import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';

export type AttendanceDeviceType = 'BIOMETRIC' | 'FACE_RECOGNITION' | 'CARD' | 'QR_TERMINAL' | 'TURNSTILE' | 'OTHER';
export const ATTENDANCE_DEVICE_TYPES: AttendanceDeviceType[] = [
  'BIOMETRIC',
  'FACE_RECOGNITION',
  'CARD',
  'QR_TERMINAL',
  'TURNSTILE',
  'OTHER',
];

export type AttendanceConnectionMode =
  | 'NETWORK_PULL'
  | 'API'
  | 'DATABASE_SYNC'
  | 'FILE_IMPORT'
  | 'MANUAL_IMPORT'
  | 'UNKNOWN';
export const ATTENDANCE_CONNECTION_MODES: AttendanceConnectionMode[] = [
  'NETWORK_PULL',
  'API',
  'DATABASE_SYNC',
  'FILE_IMPORT',
  'MANUAL_IMPORT',
  'UNKNOWN',
];

/** Auto-derived server-side from deviceType; never sent by the client. */
export type AttendanceSourceType =
  | 'MOBILE'
  | 'BIOMETRIC_DEVICE'
  | 'FACE_DEVICE'
  | 'CARD_DEVICE'
  | 'WEB'
  | 'MANUAL_CORRECTION'
  | 'IMPORT'
  | 'FUTURE_INTEGRATION';

export interface AttendanceDevice {
  id: string;
  name: string;
  deviceCode: string;
  sourceType: AttendanceSourceType;
  deviceType: AttendanceDeviceType;
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  workLocationId: string;
  ipAddress: string | null;
  port: number | null;
  connectionMode: AttendanceConnectionMode;
  isActive: boolean;
  lastSyncAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListAttendanceDevicesParams {
  page?: number;
  limit?: number;
  search?: string | undefined;
  isActive?: boolean | undefined;
  workLocationId?: string | undefined;
  deviceType?: AttendanceDeviceType | undefined;
  connectionMode?: AttendanceConnectionMode | undefined;
}

export interface CreateAttendanceDeviceInput {
  deviceCode: string;
  name: string;
  deviceType: AttendanceDeviceType;
  vendor?: string | undefined;
  model?: string | undefined;
  serialNumber?: string | undefined;
  workLocationId: string;
  ipAddress?: string | undefined;
  port?: number | undefined;
  connectionMode?: AttendanceConnectionMode | undefined;
  notes?: string | undefined;
}

export interface UpdateAttendanceDeviceInput {
  deviceCode?: string;
  name?: string;
  deviceType?: AttendanceDeviceType;
  vendor?: string | undefined;
  model?: string | undefined;
  serialNumber?: string | undefined;
  workLocationId?: string;
  ipAddress?: string | undefined;
  port?: number | undefined;
  connectionMode?: AttendanceConnectionMode | undefined;
  notes?: string | undefined;
}

export interface TestConnectionResult {
  status: string;
  message: string;
}

export function listAttendanceDevices(
  params: ListAttendanceDevicesParams = {},
): Promise<PaginatedResult<AttendanceDevice>> {
  return authorizedRequest<PaginatedResult<AttendanceDevice>>(`/attendance-devices${buildQueryString(params)}`);
}

export function getAttendanceDevice(id: string): Promise<AttendanceDevice> {
  return authorizedRequest<AttendanceDevice>(`/attendance-devices/${id}`);
}

export function createAttendanceDevice(input: CreateAttendanceDeviceInput): Promise<AttendanceDevice> {
  return authorizedRequest<AttendanceDevice>('/attendance-devices', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAttendanceDevice(id: string, input: UpdateAttendanceDeviceInput): Promise<AttendanceDevice> {
  return authorizedRequest<AttendanceDevice>(`/attendance-devices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deactivateAttendanceDevice(id: string): Promise<AttendanceDevice> {
  return authorizedRequest<AttendanceDevice>(`/attendance-devices/${id}`, { method: 'DELETE' });
}

export function testAttendanceDeviceConnection(id: string): Promise<TestConnectionResult> {
  return authorizedRequest<TestConnectionResult>(`/attendance-devices/${id}/test-connection`, { method: 'POST' });
}
