import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';
import type { AttendanceSourceType, PunchType } from './attendance-punches';

export type CorrectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export const CORRECTION_STATUSES: CorrectionStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export type CorrectionType = 'MISSED_IN' | 'MISSED_OUT' | 'WRONG_IN' | 'WRONG_OUT' | 'MANUAL_ADJUSTMENT' | 'OTHER';
export const CORRECTION_TYPES: CorrectionType[] = [
  'MISSED_IN',
  'MISSED_OUT',
  'WRONG_IN',
  'WRONG_OUT',
  'MANUAL_ADJUSTMENT',
  'OTHER',
];

interface TargetPunchRef {
  id: string;
  punchType: PunchType;
  punchTimeSource: string;
  sourceType: AttendanceSourceType;
}

export interface AttendanceCorrection {
  id: string;
  employeeId: string;
  workDate: string;
  requestedByUserId: string;
  reason: string;
  status: CorrectionStatus;
  correctionType: CorrectionType;
  requestedPunchType: PunchType | null;
  requestedPunchTime: string | null;
  targetPunchId: string | null;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string };
  requestedBy?: { id: string; username: string };
  approvedBy?: { id: string; username: string } | null;
  targetPunch?: TargetPunchRef | null;
}

export interface ApproveCorrectionResult extends AttendanceCorrection {
  manualPunchId: string | null;
  summaryId: string | null;
}

export interface ListAttendanceCorrectionsParams {
  page?: number;
  limit?: number;
  employeeId?: string | undefined;
  status?: CorrectionStatus | undefined;
  correctionType?: CorrectionType | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface ListMyAttendanceCorrectionsParams {
  page?: number;
  limit?: number;
  status?: CorrectionStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface RequestCorrectionInput {
  workDate: string;
  correctionType: CorrectionType;
  requestedPunchType?: PunchType | undefined;
  requestedPunchTime?: string | undefined;
  targetPunchId?: string | undefined;
  reason: string;
}

export interface AdminRequestCorrectionInput extends RequestCorrectionInput {
  employeeId: string;
}

export function listAttendanceCorrections(
  params: ListAttendanceCorrectionsParams = {},
): Promise<PaginatedResult<AttendanceCorrection>> {
  return authorizedRequest<PaginatedResult<AttendanceCorrection>>(
    `/attendance-corrections${buildQueryString(params)}`,
  );
}

export function getAttendanceCorrection(id: string): Promise<AttendanceCorrection> {
  return authorizedRequest<AttendanceCorrection>(`/attendance-corrections/${id}`);
}

export function listMyAttendanceCorrections(
  params: ListMyAttendanceCorrectionsParams = {},
): Promise<PaginatedResult<AttendanceCorrection>> {
  return authorizedRequest<PaginatedResult<AttendanceCorrection>>(`/attendance-corrections/me${buildQueryString(params)}`);
}

/** Self-request — kept for reuse by a future employee self-service page; not exposed on this admin screen. */
export function requestAttendanceCorrection(input: RequestCorrectionInput): Promise<AttendanceCorrection> {
  return authorizedRequest<AttendanceCorrection>('/attendance-corrections/request', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function adminRequestAttendanceCorrection(input: AdminRequestCorrectionInput): Promise<AttendanceCorrection> {
  return authorizedRequest<AttendanceCorrection>('/attendance-corrections/admin-request', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function approveAttendanceCorrection(id: string): Promise<ApproveCorrectionResult> {
  return authorizedRequest<ApproveCorrectionResult>(`/attendance-corrections/${id}/approve`, { method: 'POST' });
}

export function rejectAttendanceCorrection(id: string, rejectedReason: string): Promise<AttendanceCorrection> {
  return authorizedRequest<AttendanceCorrection>(`/attendance-corrections/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ rejectedReason }),
  });
}
