import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';
import type { AttendanceSourceType } from './attendance-punches';

export type DailyAttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'LEAVE'
  | 'WEEK_OFF'
  | 'HOLIDAY'
  | 'MISSING_PUNCH';
export const DAILY_ATTENDANCE_STATUSES: DailyAttendanceStatus[] = [
  'PRESENT',
  'ABSENT',
  'LATE',
  'HALF_DAY',
  'LEAVE',
  'WEEK_OFF',
  'HOLIDAY',
  'MISSING_PUNCH',
];

interface OfficialPunchRef {
  id: string;
  sourceType: AttendanceSourceType;
  punchTimeSource: string;
}

export interface AttendanceDailySummary {
  id: string;
  employeeId: string;
  workDate: string;
  officialInPunchId: string | null;
  officialOutPunchId: string | null;
  officialInTime: string | null;
  officialOutTime: string | null;
  totalWorkedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  status: DailyAttendanceStatus;
  calculationVersion: number;
  calculatedAt: string;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string; departmentId: string | null };
  officialInPunch?: OfficialPunchRef | null;
  officialOutPunch?: OfficialPunchRef | null;
}

export interface ListAttendanceSummariesParams {
  page?: number;
  limit?: number;
  employeeId?: string | undefined;
  departmentId?: string | undefined;
  status?: DailyAttendanceStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface ListMyAttendanceSummariesParams {
  page?: number;
  limit?: number;
  from?: string | undefined;
  to?: string | undefined;
}

export interface RecalculateRangeParams {
  employeeId?: string | undefined;
  from: string;
  to: string;
  limit?: number | undefined;
}

export interface RecalculateRangeResult {
  totalCandidateDays: number;
  calculated: number;
  skippedLocked: number;
  failed: number;
}

export function listAttendanceSummaries(
  params: ListAttendanceSummariesParams = {},
): Promise<PaginatedResult<AttendanceDailySummary>> {
  return authorizedRequest<PaginatedResult<AttendanceDailySummary>>(`/attendance-summaries${buildQueryString(params)}`);
}

export function getAttendanceSummary(id: string): Promise<AttendanceDailySummary> {
  return authorizedRequest<AttendanceDailySummary>(`/attendance-summaries/${id}`);
}

export function listMyAttendanceSummaries(
  params: ListMyAttendanceSummariesParams = {},
): Promise<PaginatedResult<AttendanceDailySummary>> {
  return authorizedRequest<PaginatedResult<AttendanceDailySummary>>(`/attendance-summaries/me${buildQueryString(params)}`);
}

export function calculateAttendanceSummary(employeeId: string, workDate: string): Promise<AttendanceDailySummary> {
  return authorizedRequest<AttendanceDailySummary>('/attendance-summaries/calculate', {
    method: 'POST',
    body: JSON.stringify({ employeeId, workDate }),
  });
}

export function recalculateAttendanceSummaryRange(params: RecalculateRangeParams): Promise<RecalculateRangeResult> {
  return authorizedRequest<RecalculateRangeResult>('/attendance-summaries/recalculate-range', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
