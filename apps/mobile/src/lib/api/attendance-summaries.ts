import { authorizedRequest } from './client';
import type { PaginatedResult } from './attendance-punches';

export type DailyAttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'LEAVE'
  | 'WEEK_OFF'
  | 'HOLIDAY'
  | 'MISSING_PUNCH';

export interface AttendanceDailySummary {
  id: string;
  employeeId: string;
  workDate: string;
  officialInTime: string | null;
  officialOutTime: string | null;
  totalWorkedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  status: DailyAttendanceStatus;
  lockedAt: string | null;
  createdAt: string;
}

export interface ListMyAttendanceSummariesParams {
  page?: number;
  limit?: number;
  from?: string | undefined;
  to?: string | undefined;
}

export function listMyAttendanceSummaries(
  params: ListMyAttendanceSummariesParams = {},
): Promise<PaginatedResult<AttendanceDailySummary>> {
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
  return authorizedRequest<PaginatedResult<AttendanceDailySummary>>(
    `/attendance-summaries/me${queryString ? `?${queryString}` : ''}`,
  );
}
