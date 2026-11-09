/**
 * Monthly attendance payroll basis — PURE calculation (Unit 20.2).
 *
 * No database, no clock, no writes. The service loads facts in bulk and calls
 * `calculateEmployeeMonth` once per employee. Rules version: MONTHLY_ATTENDANCE_RULES_VERSION.
 *
 * Core principles (docs/architecture/shift-payroll-rules.md §3):
 *  - Daily values come from the stored AttendanceDailySummary rows (never recalculated here).
 *  - Unknown is `null` plus an exception code — never a misleading 0.
 *  - HR-POLICY-01: each day is classified by the working-calendar resolver (ACTIVE records only).
 *    A verified REST_DAY / PUBLIC_HOLIDAY / APPROVED_LEAVE without attendance is resolved (0
 *    required); a SCHEDULED_WORKDAY without attendance is SCHEDULED_DAY_NO_ATTENDANCE (never
 *    "absent", never a deduction); attendance on a non-working day is WORK_ON_NON_WORKING_DAY
 *    (compensation rule pending). UNKNOWN days keep the original Unit 20.2 behaviour exactly:
 *    a shift-assigned day without a summary is MISSING coverage, and required minutes are only
 *    determined for days the employee actually attended.
 *  - No salary amounts, no deductions, no lateness/shortage double counting, no overtime offset.
 */

import {
  EMPTY_CALENDAR_CONTEXT,
  NON_WORKING_CLASSIFICATIONS,
  resolveCalendarDay,
  type CalendarContext,
  type CalendarDayResolution,
} from '../work-calendars/work-calendar.resolver';

export const MONTHLY_ATTENDANCE_RULES_VERSION = 'monthly-attendance-basis/2';

const KUWAIT_OFFSET_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Day-level exception codes. BLOCKING codes make the day's shortage (and the month's totals) unknown. */
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
  // HR-POLICY-01 (working calendar)
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
/**
 * CALCULATED   — every employment day verified; still NOT payroll approval.
 * NEEDS_REVIEW — totals determinable, but warnings exist (e.g. break/grace not applied).
 * INCOMPLETE   — at least one employment day has a blocking exception; totals are null.
 * LOCKED       — every employment day lies in a LOCKED payroll period (a lock is not an approval;
 *                exceptions are still listed).
 */
export type MonthlyReviewStatus = 'CALCULATED' | 'NEEDS_REVIEW' | 'INCOMPLETE' | 'LOCKED';

export interface ShiftFact {
  id: string;
  name: string;
  code: string | null;
  startTimeMinutes: number;
  endTimeMinutes: number;
  isOvernight: boolean;
  gracePeriodMinutes: number;
  breakMinutes: number;
  isActive: boolean;
}
export interface AssignmentFact {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  shift: ShiftFact;
}
export interface SummaryFact {
  workDate: string; // YYYY-MM-DD
  status: string;
  officialInPunchId: string | null;
  officialOutPunchId: string | null;
  officialInTime: Date | null;
  officialOutTime: Date | null;
  officialInSourceType: string | null;
  officialOutSourceType: string | null;
  totalWorkedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  lockedAt: Date | null;
}
export interface PunchCountsFact {
  pendingReview: number;
  rejected: number;
  lockedPeriodLate: number;
}
export interface EmployeeFact {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  status: string;
  hireDate: Date;
  terminationDate: Date | null;
  department: { id: string; name: string } | null;
  designation: { id: string; title: string } | null;
  workLocation: { id: string; name: string; code: string } | null;
}
export interface EmployeeMonthInput {
  employee: EmployeeFact;
  period: MonthPeriod;
  summariesByDate: Map<string, SummaryFact>;
  assignments: AssignmentFact[];
  punchCountsByDate: Map<string, PunchCountsFact>;
  pendingCorrectionsByDate: Map<string, number>;
  lockedDates: Set<string>;
  /** HR-POLICY-01: ACTIVE calendar facts; omitted means no calendar data (every day UNKNOWN). */
  calendar?: CalendarContext;
}

export interface MonthPeriod {
  month: string; // YYYY-MM
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD (inclusive)
  dates: string[];
  /** UTC instants bounding the Kuwait-time period [start, end). */
  rangeStartUtc: Date;
  rangeEndUtc: Date;
}

export interface DailyBreakdown {
  workDate: string;
  coverage: DayCoverage;
  shift: (ShiftFact & { startTime: string; endTime: string; durationMinutes: number | null }) | null;
  officialIn: { punchId: string | null; time: string | null; sourceType: string | null } | null;
  officialOut: { punchId: string | null; time: string | null; sourceType: string | null } | null;
  attendanceStatus: string | null;
  /** As stored in the daily summary (may be a placeholder 0 for MISSING_PUNCH/ABSENT). */
  recordedWorkedMinutes: number | null;
  /** Trustworthy worked minutes, or null when the day has a blocking exception. */
  workedMinutes: number | null;
  requiredMinutes: number | null;
  shortageMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  /** Informational only — no approval concept exists yet. */
  overtimeMinutes: number | null;
  payrollLocked: boolean;
  summaryLocked: boolean;
  pendingReviewPunches: number;
  rejectedPunches: number;
  pendingCorrections: number;
  exceptions: DayExceptionCode[];
  blocking: boolean;
  /** HR-POLICY-01: working-calendar classification of this day. */
  calendar: CalendarDayResolution;
}

export interface MonthlyTotals {
  /** Sum over days where required minutes are determinable. */
  requiredMinutesDeterminable: number;
  /** Full-month required minutes, or null when any employment day's requirement is unknown. */
  requiredMinutes: number | null;
  recordedWorkedMinutes: number;
  verifiedWorkedMinutes: number;
  /** Full-month shortage, or null when any employment day is unresolved. */
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
  /** null: no rest-day/holiday calendar exists, so scheduled working days cannot be determined. */
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
  /** HR-POLICY-01 classification counts over employment days. */
  restDays: number;
  publicHolidayDays: number;
  approvedLeaveDays: number;
  unknownCalendarDays: number;
}

export interface EmployeeMonthResult {
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
  dailyBreakdown: DailyBreakdown[];
}

// ------------------------------------------------------------------------------------------------

export function parseMonth(month: string): MonthPeriod {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) {
    throw new Error(`Invalid month: ${month}`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const first = Date.UTC(year, monthIndex, 1);
  const next = Date.UTC(year, monthIndex + 1, 1);
  const dates: string[] = [];
  for (let t = first; t < next; t += DAY_MS) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return {
    month,
    periodStart: dates[0] as string,
    periodEnd: dates[dates.length - 1] as string,
    dates,
    rangeStartUtc: new Date(first - KUWAIT_OFFSET_MS),
    rangeEndUtc: new Date(next - KUWAIT_OFFSET_MS),
  };
}

/**
 * Unit 21.1 — an EXACT inclusive work-date range (e.g. a payroll-lock period) in the same shape
 * as a month, so the per-day evaluation is identical. `month` is the start date's month (label only).
 */
export function parseDateRange(periodStart: string, periodEnd: string): MonthPeriod {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(periodStart) || !pattern.test(periodEnd) || periodStart > periodEnd) {
    throw new Error(`Invalid date range: ${periodStart}..${periodEnd}`);
  }
  const first = Date.parse(`${periodStart}T00:00:00.000Z`);
  const last = Date.parse(`${periodEnd}T00:00:00.000Z`);
  const dates: string[] = [];
  for (let t = first; t <= last; t += DAY_MS) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return {
    month: periodStart.slice(0, 7),
    periodStart,
    periodEnd,
    dates,
    rangeStartUtc: new Date(first - KUWAIT_OFFSET_MS),
    rangeEndUtc: new Date(last + DAY_MS - KUWAIT_OFFSET_MS),
  };
}

/** UTC [start, end) of a Kuwait calendar day — identical to kuwaitWorkDateRange. */
export function kuwaitDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(`${date}T00:00:00.000Z`) - KUWAIT_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);
const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Same selection rule as AttendanceSummaryCalculatorService.findActiveShift, plus tie detection. */
export function selectAssignment(assignments: AssignmentFact[], date: string): { assignment: AssignmentFact | null; ambiguous: boolean } {
  const { start, end } = kuwaitDayRange(date);
  const applicable = assignments.filter((a) => a.effectiveFrom < end && (a.effectiveTo === null || a.effectiveTo >= start));
  if (applicable.length === 0) return { assignment: null, ambiguous: false };
  const latest = Math.max(...applicable.map((a) => a.effectiveFrom.getTime()));
  const winners = applicable.filter((a) => a.effectiveFrom.getTime() === latest);
  return { assignment: winners[0] ?? null, ambiguous: winners.length > 1 };
}

/** Gross shift duration in minutes, or null when the configuration is invalid. */
export function shiftDuration(shift: ShiftFact): { durationMinutes: number | null; overnight: boolean } {
  const { startTimeMinutes: s, endTimeMinutes: e } = shift;
  const inRange = (m: number) => Number.isInteger(m) && m >= 0 && m < 24 * 60;
  const overnight = shift.isOvernight || e <= s;
  if (!inRange(s) || !inRange(e) || s === e || (shift.isOvernight && e > s)) {
    return { durationMinutes: null, overnight };
  }
  return { durationMinutes: overnight ? e + 24 * 60 - s : e - s, overnight };
}

function isEmployed(employee: EmployeeFact, date: string): boolean {
  if (date < dateOnly(employee.hireDate)) return false;
  return employee.terminationDate === null || date <= dateOnly(employee.terminationDate);
}

function evaluateDay(input: EmployeeMonthInput, date: string): DailyBreakdown {
  const calendarCtx = input.calendar ?? EMPTY_CALENDAR_CONTEXT;
  const summary = input.summariesByDate.get(date) ?? null;
  const counts = input.punchCountsByDate.get(date) ?? { pendingReview: 0, rejected: 0, lockedPeriodLate: 0 };
  const pendingCorrections = input.pendingCorrectionsByDate.get(date) ?? 0;
  const payrollLocked = input.lockedDates.has(date);
  const summaryLocked = summary?.lockedAt != null;
  const exceptions = new Set<DayExceptionCode>();

  const base = {
    workDate: date,
    payrollLocked,
    summaryLocked,
    pendingReviewPunches: counts.pendingReview,
    rejectedPunches: counts.rejected,
    pendingCorrections,
  };

  if (!isEmployed(input.employee, date)) {
    return {
      ...base,
      coverage: 'NOT_EMPLOYED',
      shift: null,
      officialIn: null,
      officialOut: null,
      attendanceStatus: null,
      recordedWorkedMinutes: null,
      workedMinutes: null,
      requiredMinutes: null,
      shortageMinutes: null,
      lateMinutes: null,
      earlyLeaveMinutes: null,
      overtimeMinutes: null,
      exceptions: [],
      blocking: false,
      calendar: resolveCalendarDay(calendarCtx, { employeeId: input.employee.id, date, employed: false, shift: null, shiftAmbiguous: false }),
    };
  }

  const { assignment, ambiguous } = selectAssignment(input.assignments, date);
  const shift = assignment?.shift ?? null;
  const { durationMinutes, overnight } = shift ? shiftDuration(shift) : { durationMinutes: null, overnight: false };
  const calendar = resolveCalendarDay(calendarCtx, {
    employeeId: input.employee.id,
    date,
    employed: true,
    shift: shift ? { id: shift.id, overnight, durationMinutes } : null,
    shiftAmbiguous: ambiguous,
  });
  const nonWorking = NON_WORKING_CLASSIFICATIONS.includes(calendar.classification);
  // A verified non-working day with no attendance needs no shift at all.
  const idleNonWorking = nonWorking && !summary && counts.pendingReview === 0;

  if (!idleNonWorking) {
    if (!shift) exceptions.add('NO_SHIFT_ASSIGNMENT');
    if (ambiguous) exceptions.add('SHIFT_ASSIGNMENT_AMBIGUOUS');
    if (shift && durationMinutes === null) exceptions.add('SHIFT_CONFIGURATION_INVALID');
    if (shift && !shift.isActive) exceptions.add('SHIFT_INACTIVE');
    if (shift && overnight && durationMinutes !== null) exceptions.add('OVERNIGHT_SHIFT_CALENDAR_SPLIT');
  }
  if (calendar.conflicts.length > 0) exceptions.add('WORK_CALENDAR_CONFLICT');
  if (counts.pendingReview > 0) exceptions.add('PENDING_REVIEW_PUNCHES');
  if (pendingCorrections > 0) exceptions.add('PENDING_CORRECTION');
  if (counts.rejected > 0) exceptions.add('REJECTED_PUNCHES');
  if (counts.lockedPeriodLate > 0) exceptions.add('LOCKED_PERIOD_LATE_PUNCH');

  let coverage: DayCoverage;
  if (summary) {
    coverage = 'SUMMARY';
    if (summary.status === 'MISSING_PUNCH') exceptions.add('MISSING_PUNCH');
    if (summary.status === 'ABSENT') exceptions.add('ABSENT_NOT_HR_CONFIRMED');
    if (summary.officialInTime && summary.officialOutTime && summary.officialOutTime < summary.officialInTime) {
      exceptions.add('OUT_BEFORE_IN');
    }
    const worked = summary.status === 'PRESENT' || summary.status === 'LATE';
    if (shift && shift.breakMinutes > 0 && worked) exceptions.add('BREAK_NOT_APPLIED');
    if (shift && shift.gracePeriodMinutes > 0 && summary.lateMinutes > 0) exceptions.add('GRACE_NOT_APPLIED');
    // Attendance on a verified rest day / holiday / leave day: compensation rule not decided.
    if (nonWorking) exceptions.add('WORK_ON_NON_WORKING_DAY');
  } else if (nonWorking) {
    coverage = 'NON_WORKING_DAY';
  } else if (calendar.classification === 'SCHEDULED_WORKDAY') {
    // Scheduled but no attendance: absence or unrecorded leave cannot be told apart. Never "absent".
    coverage = shift ? 'NO_DAILY_SUMMARY' : 'NO_SHIFT_ASSIGNMENT';
    exceptions.add('SCHEDULED_DAY_NO_ATTENDANCE');
  } else {
    coverage = shift ? 'NO_DAILY_SUMMARY' : 'NO_SHIFT_ASSIGNMENT';
    if (shift) exceptions.add('MISSING_DAILY_SUMMARY');
  }

  const codes = [...exceptions].sort() as DayExceptionCode[];
  const blocking = codes.some((c) => (BLOCKING_DAY_CODES as readonly string[]).includes(c));

  // Required minutes are determinable only when the employee attended (an official punch exists)
  // and the shift configuration is valid. Never assumed for days without attendance.
  // HR-POLICY-01: a verified calendar makes the requirement known even without attendance
  // (0 on an idle non-working day, the shift length on a scheduled day). UNKNOWN days keep the rule.
  const attended = summary !== null && (summary.officialInPunchId !== null || summary.officialOutPunchId !== null);
  let requiredMinutes: number | null;
  if (nonWorking) requiredMinutes = summary ? null : 0; // worked rest day: rule pending
  else if (calendar.classification === 'SCHEDULED_WORKDAY') requiredMinutes = calendar.scheduledMinutes;
  else requiredMinutes = attended && durationMinutes !== null && !ambiguous ? durationMinutes : null;
  const workedMinutes = summary && !blocking ? summary.totalWorkedMinutes : idleNonWorking && !blocking ? 0 : null;
  const shortageMinutes =
    !blocking && requiredMinutes !== null && workedMinutes !== null ? Math.max(0, requiredMinutes - workedMinutes) : null;

  return {
    ...base,
    coverage,
    shift: shift
      ? { ...shift, startTime: hhmm(shift.startTimeMinutes), endTime: hhmm(shift.endTimeMinutes), durationMinutes }
      : null,
    officialIn: summary?.officialInPunchId
      ? { punchId: summary.officialInPunchId, time: summary.officialInTime?.toISOString() ?? null, sourceType: summary.officialInSourceType }
      : null,
    officialOut: summary?.officialOutPunchId
      ? { punchId: summary.officialOutPunchId, time: summary.officialOutTime?.toISOString() ?? null, sourceType: summary.officialOutSourceType }
      : null,
    attendanceStatus: summary?.status ?? null,
    recordedWorkedMinutes: summary?.totalWorkedMinutes ?? null,
    workedMinutes,
    requiredMinutes,
    shortageMinutes,
    lateMinutes: summary?.lateMinutes ?? null,
    earlyLeaveMinutes: summary?.earlyLeaveMinutes ?? null,
    overtimeMinutes: summary?.overtimeMinutes ?? null,
    exceptions: codes,
    blocking,
    calendar,
  };
}

export function calculateEmployeeMonth(input: EmployeeMonthInput): EmployeeMonthResult {
  const daily = input.period.dates.map((date) => evaluateDay(input, date));
  const employed = daily.filter((d) => d.coverage !== 'NOT_EMPLOYED');
  const sum = (values: (number | null)[]) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

  const dayCountsByCode: Partial<Record<DayExceptionCode, number>> = {};
  for (const day of employed) {
    for (const code of day.exceptions) dayCountsByCode[code] = (dayCountsByCode[code] ?? 0) + 1;
  }
  const monthCodes = new Set<MonthExceptionCode>(Object.keys(dayCountsByCode) as DayExceptionCode[]);
  if (employed.length === 0) monthCodes.add('NO_EMPLOYMENT_DAYS_IN_PERIOD');
  if (employed.some((d) => d.coverage === 'NO_DAILY_SUMMARY' && d.calendar.classification === 'UNKNOWN')) {
    monthCodes.add('REST_DAY_CALENDAR_NOT_CONFIGURED');
  }
  const calendarKnown = employed.length > 0 && employed.every((d) => d.calendar.classification !== 'UNKNOWN');

  const unresolved = employed.filter((d) => d.blocking);
  const requirementUnknown = employed.some((d) => d.requiredMinutes === null);
  const lockedEmployedDates = employed.filter((d) => d.payrollLocked || d.summaryLocked).map((d) => d.workDate);
  const fullyLocked = employed.length > 0 && lockedEmployedDates.length === employed.length;

  let reviewStatus: MonthlyReviewStatus;
  if (fullyLocked) reviewStatus = 'LOCKED';
  else if (employed.length === 0 || unresolved.length > 0) reviewStatus = 'INCOMPLETE';
  else if (employed.some((d) => d.exceptions.length > 0)) reviewStatus = 'NEEDS_REVIEW';
  else reviewStatus = 'CALCULATED';

  const count = (predicate: (d: DailyBreakdown) => boolean) => employed.filter(predicate).length;
  const countCode = (code: DayExceptionCode) => dayCountsByCode[code] ?? 0;
  const e = input.employee;

  return {
    rulesVersion: MONTHLY_ATTENDANCE_RULES_VERSION,
    employee: {
      id: e.id,
      employeeCode: e.employeeCode,
      name: `${e.firstName} ${e.lastName}`.trim(),
      status: e.status,
      department: e.department,
      designation: e.designation,
      workLocation: e.workLocation,
    },
    period: {
      month: input.period.month,
      periodStart: input.period.periodStart,
      periodEnd: input.period.periodEnd,
      calendarDays: input.period.dates.length,
    },
    reviewStatus,
    totals: {
      requiredMinutesDeterminable: sum(employed.map((d) => d.requiredMinutes)),
      requiredMinutes: requirementUnknown || employed.length === 0 ? null : sum(employed.map((d) => d.requiredMinutes)),
      recordedWorkedMinutes: sum(employed.map((d) => d.recordedWorkedMinutes)),
      verifiedWorkedMinutes: sum(employed.map((d) => d.workedMinutes)),
      shortageMinutes:
        unresolved.length > 0 || requirementUnknown || employed.length === 0 ? null : sum(employed.map((d) => d.shortageMinutes)),
      verifiedShortageMinutes: sum(employed.map((d) => d.shortageMinutes)),
      lateMinutes: sum(employed.map((d) => d.lateMinutes)),
      earlyLeaveMinutes: sum(employed.map((d) => d.earlyLeaveMinutes)),
      overtimeMinutesInformational: sum(employed.map((d) => d.overtimeMinutes)),
    },
    days: {
      calendarDays: input.period.dates.length,
      employmentDays: employed.length,
      shiftAssignedDays: count((d) => d.shift !== null),
      scheduledWorkingDays: calendarKnown ? count((d) => d.calendar.classification === 'SCHEDULED_WORKDAY') : null,
      presentDays: count((d) => d.attendanceStatus === 'PRESENT'),
      lateDays: count((d) => d.attendanceStatus === 'LATE'),
      absentDays: count((d) => d.attendanceStatus === 'ABSENT'),
      missingPunchDays: count((d) => d.attendanceStatus === 'MISSING_PUNCH'),
      missingSummaryDays: count((d) => d.coverage === 'NO_DAILY_SUMMARY'),
      noShiftDays: count((d) => d.shift === null),
      lockedDays: lockedEmployedDates.length,
      unresolvedDays: unresolved.length,
      daysWithWarnings: count((d) => d.exceptions.length > 0),
      restDays: count((d) => d.calendar.classification === 'REST_DAY'),
      publicHolidayDays: count((d) => d.calendar.classification === 'PUBLIC_HOLIDAY'),
      approvedLeaveDays: count((d) => d.calendar.classification === 'APPROVED_LEAVE'),
      unknownCalendarDays: count((d) => d.calendar.classification === 'UNKNOWN'),
    },
    exceptions: {
      codes: [...monthCodes].sort(),
      dayCountsByCode,
      pendingReviewPunches: sum(employed.map((d) => d.pendingReviewPunches)),
      rejectedPunches: sum(employed.map((d) => d.rejectedPunches)),
      pendingCorrections: sum(employed.map((d) => d.pendingCorrections)),
      shiftConfigurationProblemDays: count((d) =>
        d.exceptions.some((c) => c === 'SHIFT_CONFIGURATION_INVALID' || c === 'SHIFT_INACTIVE' || c === 'SHIFT_ASSIGNMENT_AMBIGUOUS'),
      ),
      overnightReviewDays: countCode('OVERNIGHT_SHIFT_CALENDAR_SPLIT'),
      invalidSequenceDays: countCode('OUT_BEFORE_IN'),
    },
    payrollLock: {
      overlapsLockedPeriod: daily.some((d) => d.payrollLocked),
      fullyLocked,
      lockedDates: daily.filter((d) => d.payrollLocked).map((d) => d.workDate),
      lockedSummaryCount: [...input.summariesByDate.values()].filter((s) => s.lockedAt !== null).length,
    },
    dailyBreakdown: daily,
  };
}
