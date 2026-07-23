import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';

export type PunchType = 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END';
export const PUNCH_TYPES: PunchType[] = ['IN', 'OUT', 'BREAK_START', 'BREAK_END'];

export type AttendanceSourceType =
  | 'MOBILE'
  | 'BIOMETRIC_DEVICE'
  | 'FACE_DEVICE'
  | 'CARD_DEVICE'
  | 'WEB'
  | 'MANUAL_CORRECTION'
  | 'IMPORT'
  | 'FUTURE_INTEGRATION';
export const ATTENDANCE_SOURCE_TYPES: AttendanceSourceType[] = [
  'MOBILE',
  'BIOMETRIC_DEVICE',
  'FACE_DEVICE',
  'CARD_DEVICE',
  'WEB',
  'MANUAL_CORRECTION',
  'IMPORT',
  'FUTURE_INTEGRATION',
];

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
export const PUNCH_VALIDATION_STATUSES: PunchValidationStatus[] = [
  'ACCEPTED',
  'ACCEPTED_WITH_WARNING',
  'REJECTED_OUTSIDE_LOCATION',
  'REJECTED_FAKE_GPS',
  'REJECTED_UNREGISTERED_DEVICE',
  'REJECTED_EMPLOYEE_INACTIVE',
  'REJECTED_DUPLICATE',
  'PENDING_HR_REVIEW',
  'PENDING_MANAGER_APPROVAL',
  'REJECTED_POLICY_VIOLATION',
];

export interface AttendanceRawPunch {
  id: string;
  employeeId: string;
  punchType: PunchType;
  sourceType: AttendanceSourceType;
  sourceId: string | null;
  sourceDeviceId: string | null;
  punchTimeSource: string;
  punchTimeServer: string;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  distanceFromLocationMeters: number | null;
  workLocationId: string | null;
  mobileDeviceId: string | null;
  attendanceDeviceId: string | null;
  ipAddress: string | null;
  wifiSsid: string | null;
  wifiBssid: string | null;
  selfieFileId: string | null;
  validationStatus: PunchValidationStatus;
  fraudScore: number;
  fraudFlags: Record<string, unknown>[];
  rawPayload: Record<string, unknown>;
  isOfficial: boolean;
  duplicateOfPunchId: string | null;
  validatedAt: string | null;
  validatedByUserId: string | null;
  createdAt: string;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string };
  workLocation?: { id: string; name: string; code: string } | null;
  mobileDevice?: { id: string; deviceIdentifier: string; platform: string } | null;
  attendanceDevice?: { id: string; name: string; deviceCode: string } | null;
}

export interface ListAttendancePunchesParams {
  page?: number;
  limit?: number;
  employeeId?: string | undefined;
  workLocationId?: string | undefined;
  sourceType?: AttendanceSourceType | undefined;
  punchType?: PunchType | undefined;
  validationStatus?: PunchValidationStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface ListMyAttendancePunchesParams {
  page?: number;
  limit?: number;
  from?: string | undefined;
  to?: string | undefined;
}

export interface CreateMobilePunchInput {
  punchType: PunchType;
  punchTimeSource: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  gpsAccuracy?: number | undefined;
  workLocationId?: string | undefined;
  deviceIdentifier: string;
  wifiSsid?: string | undefined;
  wifiBssid?: string | undefined;
  appVersion?: string | undefined;
  fraudSignals?: Record<string, unknown> | undefined;
  selfieFileId?: string | undefined;
}

export interface CreateDeviceImportPunchInput {
  attendanceDeviceId: string;
  sourceId?: string | undefined;
  employeeCode: string;
  punchType: PunchType;
  punchTimeSource: string;
}

export interface CreateManualPunchInput {
  employeeId: string;
  punchType: PunchType;
  punchTimeSource: string;
  reason: string;
}

export interface ValidatePendingParams {
  employeeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
}

export interface ValidatePendingResult {
  totalProcessed: number;
  accepted: number;
  rejected: number;
  pending: number;
  /** New in Unit 20.1 — how many of the accepted punches above triggered a daily summary recalculation, and how many were skipped because their date falls inside a locked payroll period. */
  summariesRecalculated: number;
  skippedLocked: number;
}

export function listAttendancePunches(
  params: ListAttendancePunchesParams = {},
): Promise<PaginatedResult<AttendanceRawPunch>> {
  return authorizedRequest<PaginatedResult<AttendanceRawPunch>>(`/attendance-punches${buildQueryString(params)}`);
}

export function getAttendancePunch(id: string): Promise<AttendanceRawPunch> {
  return authorizedRequest<AttendanceRawPunch>(`/attendance-punches/${id}`);
}

export function listMyAttendancePunches(
  params: ListMyAttendancePunchesParams = {},
): Promise<PaginatedResult<AttendanceRawPunch>> {
  return authorizedRequest<PaginatedResult<AttendanceRawPunch>>(`/attendance-punches/me${buildQueryString(params)}`);
}

/** Kept for testing/reuse — real mobile punches come from the mobile app, not this admin UI. */
export function createMobilePunch(input: CreateMobilePunchInput): Promise<AttendanceRawPunch> {
  return authorizedRequest<AttendanceRawPunch>('/attendance-punches/mobile', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createDeviceImportPunch(input: CreateDeviceImportPunchInput): Promise<AttendanceRawPunch> {
  return authorizedRequest<AttendanceRawPunch>('/attendance-punches/device-import', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createManualPunch(input: CreateManualPunchInput): Promise<AttendanceRawPunch> {
  return authorizedRequest<AttendanceRawPunch>('/attendance-punches/manual', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function validatePunch(id: string): Promise<AttendanceRawPunch> {
  return authorizedRequest<AttendanceRawPunch>(`/attendance-punches/${id}/validate`, { method: 'POST' });
}

export function validatePendingPunches(params: ValidatePendingParams = {}): Promise<ValidatePendingResult> {
  return authorizedRequest<ValidatePendingResult>('/attendance-punches/validate-pending', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
