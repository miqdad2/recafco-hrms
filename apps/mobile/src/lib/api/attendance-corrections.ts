import { authorizedRequest } from './client';
import type { PaginatedResult, PunchType } from './attendance-punches';

export type CorrectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type CorrectionType =
  | 'MISSED_IN'
  | 'MISSED_OUT'
  | 'WRONG_IN'
  | 'WRONG_OUT'
  | 'MANUAL_ADJUSTMENT'
  | 'OTHER';

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
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

export interface RequestAttendanceCorrectionInput {
  workDate: string;
  correctionType: CorrectionType;
  requestedPunchType?: PunchType | undefined;
  requestedPunchTime?: string | undefined;
  targetPunchId?: string | undefined;
  reason: string;
}

export function requestAttendanceCorrection(
  input: RequestAttendanceCorrectionInput,
): Promise<AttendanceCorrection> {
  return authorizedRequest<AttendanceCorrection>('/attendance-corrections/request', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ListMyAttendanceCorrectionsParams {
  page?: number;
  limit?: number;
  status?: CorrectionStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export function listMyAttendanceCorrections(
  params: ListMyAttendanceCorrectionsParams = {},
): Promise<PaginatedResult<AttendanceCorrection>> {
  const query = new URLSearchParams();
  if (params.page) {
    query.set('page', String(params.page));
  }
  if (params.limit) {
    query.set('limit', String(params.limit));
  }
  if (params.status) {
    query.set('status', params.status);
  }
  if (params.from) {
    query.set('from', params.from);
  }
  if (params.to) {
    query.set('to', params.to);
  }
  const queryString = query.toString();
  return authorizedRequest<PaginatedResult<AttendanceCorrection>>(
    `/attendance-corrections/me${queryString ? `?${queryString}` : ''}`,
  );
}
