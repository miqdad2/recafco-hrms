import { authorizedRequest } from './client';

export type PunchType = 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END';

export type AttendanceSourceType =
  | 'MOBILE'
  | 'BIOMETRIC_DEVICE'
  | 'FACE_DEVICE'
  | 'CARD_DEVICE'
  | 'WEB'
  | 'MANUAL_CORRECTION'
  | 'IMPORT'
  | 'FUTURE_INTEGRATION';

export type PunchValidationStatus =
  | 'ACCEPTED'
  | 'ACCEPTED_WITH_WARNING'
  | 'REJECTED_OUTSIDE_LOCATION'
  | 'REJECTED_FAKE_GPS'
  | 'REJECTED_UNREGISTERED_DEVICE'
  | 'REJECTED_EMPLOYEE_INACTIVE'
  | 'REJECTED_DUPLICATE'
  | 'PENDING_HR_REVIEW'
  | 'PENDING_MANAGER_APPROVAL'
  | 'REJECTED_POLICY_VIOLATION';

export interface AttendanceRawPunch {
  id: string;
  employeeId: string;
  punchType: PunchType;
  sourceType: AttendanceSourceType;
  punchTimeSource: string;
  punchTimeServer: string;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  workLocationId: string | null;
  mobileDeviceId: string | null;
  attendanceDeviceId: string | null;
  validationStatus: PunchValidationStatus;
  isOfficial: boolean;
  duplicateOfPunchId: string | null;
  createdAt: string;
}

export interface ListMyAttendancePunchesParams {
  page?: number;
  limit?: number;
  from?: string | undefined;
  to?: string | undefined;
}

export interface CreateMobilePunchInput {
  punchType: 'IN' | 'OUT';
  punchTimeSource: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  gpsAccuracy?: number | undefined;
  deviceIdentifier: string;
  workLocationId?: string | undefined;
  wifiSsid?: string | undefined;
  wifiBssid?: string | undefined;
  appVersion?: string | undefined;
  fraudSignals?: Record<string, unknown> | undefined;
}

export function createMobilePunch(input: CreateMobilePunchInput): Promise<AttendanceRawPunch> {
  return authorizedRequest<AttendanceRawPunch>('/attendance-punches/mobile', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function listMyAttendancePunches(
  params: ListMyAttendancePunchesParams = {},
): Promise<PaginatedResult<AttendanceRawPunch>> {
  const query = new URLSearchParams();
  if (params.page) {
    query.set('page', String(params.page));
  }
  if (params.limit) {
    query.set('limit', String(params.limit));
  }
  if (params.from) {
    query.set('from', params.from);
  }
  if (params.to) {
    query.set('to', params.to);
  }
  const queryString = query.toString();
  return authorizedRequest<PaginatedResult<AttendanceRawPunch>>(
    `/attendance-punches/me${queryString ? `?${queryString}` : ''}`,
  );
}
