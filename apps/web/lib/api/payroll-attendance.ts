import { authorizedRequest, buildQueryString, type PaginatedResult } from './client';
import type { CalendarDayResolution } from './work-calendars';

/**
 * Unit 21 — typed client for the Unit 20.2 read-only monthly payroll-attendance basis
 * (apps/api/src/payroll-attendance). Shapes mirror monthly-attendance.calculator.ts and
 * payroll-attendance.service.ts exactly; nothing here is derived or invented client-side.
 * All values are minutes / day counts — there are no salary amounts anywhere in this contract.
 */

export const BLOCKING_DAY_CODES = [
  'NO_SHIFT_ASSIGNMENT',
  'SHIFT_ASSIGNMENT_AMBIGUOUS',
  'SHIFT_CONFIGURATION_INVALID',
  'SHIFT_INACTIVE',
  'OVERNIGHT_SHIFT_CALENDAR_SPLIT',
  'MISSING_DAILY_SUMMARY',
  'MISSING_PUNCH',
  'OUT_BEFORE_IN',
  'ABSENT_NOT_HR_CONFIRMED',
  'PENDING_REVIEW_PUNCHES',
  'PENDING_CORRECTION',
  // HR-POLICY-01
  'SCHEDULED_DAY_NO_ATTENDANCE',
  'WORK_ON_NON_WORKING_DAY',
  'WORK_CALENDAR_CONFLICT',
] as const;
export const WARNING_DAY_CODES = [
  'BREAK_NOT_APPLIED',
  'GRACE_NOT_APPLIED',
  'REJECTED_PUNCHES',
  'LOCKED_PERIOD_LATE_PUNCH',
] as const;
export type DayExceptionCode = (typeof BLOCKING_DAY_CODES)[number] | (typeof WARNING_DAY_CODES)[number];
export type MonthExceptionCode = DayExceptionCode | 'REST_DAY_CALENDAR_NOT_CONFIGURED' | 'NO_EMPLOYMENT_DAYS_IN_PERIOD';

export type DayCoverage = 'NOT_EMPLOYED' | 'NO_SHIFT_ASSIGNMENT' | 'NO_DAILY_SUMMARY' | 'SUMMARY' | 'NON_WORKING_DAY';
export type MonthlyReviewStatus = 'CALCULATED' | 'NEEDS_REVIEW' | 'INCOMPLETE' | 'LOCKED';
export const MONTHLY_REVIEW_STATUSES: MonthlyReviewStatus[] = ['CALCULATED', 'NEEDS_REVIEW', 'INCOMPLETE', 'LOCKED'];

export interface ShiftInfo {
  id: string;
  name: string;
  code: string | null;
  startTimeMinutes: number;
  endTimeMinutes: number;
  isOvernight: boolean;
  gracePeriodMinutes: number;
  breakMinutes: number;
  isActive: boolean;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
}

export interface OfficialPunchInfo {
  punchId: string | null;
  time: string | null;
  sourceType: string | null;
}

export interface DailyBreakdown {
  workDate: string;
  coverage: DayCoverage;
  shift: ShiftInfo | null;
  officialIn: OfficialPunchInfo | null;
  officialOut: OfficialPunchInfo | null;
  attendanceStatus: string | null;
  /** As stored in the daily summary — may be a placeholder 0 for MISSING_PUNCH/ABSENT. Never display as worked time. */
  recordedWorkedMinutes: number | null;
  /** Trustworthy worked minutes, or null when the day has a blocking exception. */
  workedMinutes: number | null;
  requiredMinutes: number | null;
  shortageMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  overtimeMinutes: number | null;
  payrollLocked: boolean;
  summaryLocked: boolean;
  pendingReviewPunches: number;
  rejectedPunches: number;
  pendingCorrections: number;
  exceptions: DayExceptionCode[];
  blocking: boolean;
  /** HR-POLICY-01 — working-calendar classification. */
  calendar: CalendarDayResolution;
}

export interface MonthlyTotals {
  requiredMinutesDeterminable: number;
  requiredMinutes: number | null;
  recordedWorkedMinutes: number;
  verifiedWorkedMinutes: number;
  shortageMinutes: number | null;
  verifiedShortageMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutesInformational: number;
}

export interface MonthlyDayCounts {
  calendarDays: number;
  employmentDays: number;
  shiftAssignedDays: number;
  scheduledWorkingDays: number | null;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  missingPunchDays: number;
  missingSummaryDays: number;
  noShiftDays: number;
  lockedDays: number;
  unresolvedDays: number;
  daysWithWarnings: number;
  restDays: number;
  publicHolidayDays: number;
  approvedLeaveDays: number;
  unknownCalendarDays: number;
}

export interface MonthlyEmployeeRecord {
  rulesVersion: string;
  employee: {
    id: string;
    employeeCode: string;
    name: string;
    status: string;
    department: { id: string; name: string } | null;
    designation: { id: string; title: string } | null;
    workLocation: { id: string; name: string; code: string } | null;
  };
  period: { month: string; periodStart: string; periodEnd: string; calendarDays: number };
  reviewStatus: MonthlyReviewStatus;
  totals: MonthlyTotals;
  days: MonthlyDayCounts;
  exceptions: {
    codes: MonthExceptionCode[];
    dayCountsByCode: Partial<Record<DayExceptionCode, number>>;
    pendingReviewPunches: number;
    rejectedPunches: number;
    pendingCorrections: number;
    shiftConfigurationProblemDays: number;
    overnightReviewDays: number;
    invalidSequenceDays: number;
  };
  payrollLock: { overlapsLockedPeriod: boolean; fullyLocked: boolean; lockedDates: string[]; lockedSummaryCount: number };
}

export interface EmployeeMonthResult extends MonthlyEmployeeRecord {
  dailyBreakdown: DailyBreakdown[];
}

export interface MonthlyAttendanceSummary {
  rulesVersion: string;
  period: { month: string; periodStart: string; periodEnd: string; calendarDays: number };
  filters: { employeeId: string | null; departmentId: string | null; workLocationId: string | null };
  employeeCount: number;
  reviewStatusCounts: Record<MonthlyReviewStatus, number>;
  /** true only when every employee is CALCULATED — still NOT payroll approval. */
  allEmployeesCalculated: boolean;
  totals: {
    requiredMinutesDeterminable: number;
    recordedWorkedMinutes: number;
    verifiedWorkedMinutes: number;
    verifiedShortageMinutes: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    overtimeMinutesInformational: number;
    requiredMinutes: number | null;
    shortageMinutes: number | null;
  };
  /** Summed per-employee day counts; scheduledWorkingDays is always null (no rest-day calendar). */
  days: Partial<Record<keyof MonthlyDayCounts, number>> & { scheduledWorkingDays: null };
  exceptions: {
    dayCountsByCode: Partial<Record<DayExceptionCode, number>>;
    employeesByCode: Partial<Record<MonthExceptionCode, number>>;
    pendingReviewPunches: number;
    rejectedPunches: number;
    pendingCorrections: number;
  };
  payrollLock: { overlapsLockedPeriod: boolean; lockedDates: string[] };
}

export interface MonthlyAttendanceFilter {
  month: string;
  employeeId?: string | undefined;
  departmentId?: string | undefined;
  workLocationId?: string | undefined;
}

export interface MonthlyAttendanceListParams extends MonthlyAttendanceFilter {
  page?: number;
  /** Backend maximum is 100. */
  limit?: number;
}

/** `GET /payroll-attendance/monthly` — one page of employees (no daily breakdown). Requires `payrollAttendance.read`. */
export function listMonthlyAttendance(
  params: MonthlyAttendanceListParams,
  signal?: AbortSignal,
): Promise<PaginatedResult<MonthlyEmployeeRecord> & { rulesVersion: string }> {
  return authorizedRequest(`/payroll-attendance/monthly${buildQueryString(params)}`, { signal: signal ?? null });
}

/** `GET /payroll-attendance/monthly/summary` — company-wide totals over ALL matching employees (~4 s at 2,000). */
export function getMonthlyAttendanceSummary(
  filter: MonthlyAttendanceFilter,
  signal?: AbortSignal,
): Promise<MonthlyAttendanceSummary> {
  return authorizedRequest(`/payroll-attendance/monthly/summary${buildQueryString(filter)}`, { signal: signal ?? null });
}

/** `GET /payroll-attendance/monthly/:employeeId?month=` — one employee's month with the daily breakdown. */
export function getEmployeeMonthlyAttendance(
  employeeId: string,
  month: string,
  signal?: AbortSignal,
): Promise<EmployeeMonthResult> {
  return authorizedRequest(
    `/payroll-attendance/monthly/${encodeURIComponent(employeeId)}${buildQueryString({ month })}`,
    { signal: signal ?? null },
  );
}
