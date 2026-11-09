import type { BadgeTone } from '@/components/ui/status-badge';
import type { DayCoverage, MonthExceptionCode, MonthlyReviewStatus } from '@/lib/api/payroll-attendance';

/**
 * Unit 21 — user-facing labels for the Unit 20.2 backend codes. Labels only translate the
 * backend's own codes; they never reinterpret them. The technical code is always shown
 * alongside (secondary text) so HR/admins can match it to docs/architecture/shift-payroll-rules.md.
 */

export const NOT_CALCULATED = '—';

export const REVIEW_STATUS_LABELS: Record<MonthlyReviewStatus, string> = {
  CALCULATED: 'Calculated',
  NEEDS_REVIEW: 'Needs Review',
  INCOMPLETE: 'Incomplete',
  LOCKED: 'Locked',
};

export const REVIEW_STATUS_TONES: Record<MonthlyReviewStatus, BadgeTone> = {
  CALCULATED: 'success',
  NEEDS_REVIEW: 'warning',
  INCOMPLETE: 'error',
  LOCKED: 'locked',
};

export const REVIEW_STATUS_DESCRIPTIONS: Record<MonthlyReviewStatus, string> = {
  CALCULATED: 'Every day could be verified. This is not payroll approval.',
  NEEDS_REVIEW: 'Totals are known, but warnings need HR review.',
  INCOMPLETE: 'One or more days could not be calculated, so monthly totals are not available.',
  LOCKED: 'Every employment day is in a locked payroll period. Locking is not payroll approval; issues are still listed.',
};

interface ExceptionInfo {
  label: string;
  description: string;
  severity: 'blocking' | 'warning' | 'month';
}

export const EXCEPTION_INFO: Record<MonthExceptionCode, ExceptionInfo> = {
  NO_SHIFT_ASSIGNMENT: {
    label: 'No assigned shift',
    description: 'No shift is assigned to the employee on this day, so required hours are unknown.',
    severity: 'blocking',
  },
  SHIFT_ASSIGNMENT_AMBIGUOUS: {
    label: 'Conflicting shift assignments',
    description: 'Two shift assignments start on the same date; the correct shift cannot be chosen.',
    severity: 'blocking',
  },
  SHIFT_CONFIGURATION_INVALID: {
    label: 'Shift setup is invalid',
    description: 'The assigned shift has an invalid start/end/break configuration.',
    severity: 'blocking',
  },
  SHIFT_INACTIVE: {
    label: 'Assigned shift is inactive',
    description: 'The shift assigned on this day has been deactivated.',
    severity: 'blocking',
  },
  OVERNIGHT_SHIFT_CALENDAR_SPLIT: {
    label: 'Night shift requires review',
    description: 'Overnight shifts cross midnight; the payroll rule for splitting them is not decided yet.',
    severity: 'blocking',
  },
  MISSING_DAILY_SUMMARY: {
    label: 'No attendance record',
    description:
      'No daily attendance record exists for this day. It may be a day off — rest days and holidays are not configured yet.',
    severity: 'blocking',
  },
  MISSING_PUNCH: {
    label: 'Missing Check In or Check Out',
    description: 'Only one of Check In / Check Out was recorded.',
    severity: 'blocking',
  },
  OUT_BEFORE_IN: {
    label: 'Check Out is before Check In',
    description: 'The recorded Check Out time is earlier than Check In.',
    severity: 'blocking',
  },
  ABSENT_NOT_HR_CONFIRMED: {
    label: 'Absence not confirmed by HR',
    description: 'The day is marked absent, but there is no HR confirmation step yet.',
    severity: 'blocking',
  },
  PENDING_REVIEW_PUNCHES: {
    label: 'Punch awaiting review',
    description: 'A punch on this day is waiting for HR review.',
    severity: 'blocking',
  },
  PENDING_CORRECTION: {
    label: 'Correction awaiting approval',
    description: 'An attendance correction for this day has not been approved or rejected.',
    severity: 'blocking',
  },
  SCHEDULED_DAY_NO_ATTENDANCE: {
    label: 'Scheduled workday without attendance',
    description:
      'The approved calendar says this was a working day, but there is no attendance. It may be an absence or leave that is not recorded — it is never treated as absent automatically.',
    severity: 'blocking',
  },
  WORK_ON_NON_WORKING_DAY: {
    label: 'Worked on a rest day or holiday',
    description: 'Attendance exists on a day the approved calendar marks as rest day, public holiday or leave. The compensation rule is not decided yet.',
    severity: 'blocking',
  },
  WORK_CALENDAR_CONFLICT: {
    label: 'Conflicting calendar settings',
    description: 'Two calendar assignments or day exceptions disagree for this day. Fix the calendar setup.',
    severity: 'blocking',
  },
  BREAK_NOT_APPLIED: {
    label: 'Break policy not applied',
    description: 'The shift has a break, but worked hours do not deduct it (HR decision pending).',
    severity: 'warning',
  },
  GRACE_NOT_APPLIED: {
    label: 'Grace period not applied',
    description: 'The shift has a grace period, but late minutes do not apply it (HR decision pending).',
    severity: 'warning',
  },
  REJECTED_PUNCHES: {
    label: 'Rejected punch attempts',
    description: 'One or more punch attempts on this day were rejected.',
    severity: 'warning',
  },
  LOCKED_PERIOD_LATE_PUNCH: {
    label: 'Punch arrived after period was locked',
    description: 'A punch was received for this day after its payroll period was locked.',
    severity: 'warning',
  },
  REST_DAY_CALENDAR_NOT_CONFIGURED: {
    label: 'Rest-day calendar not configured',
    description: 'Some days have no attendance record and the system cannot tell a day off from an absence.',
    severity: 'month',
  },
  NO_EMPLOYMENT_DAYS_IN_PERIOD: {
    label: 'Not employed this month',
    description: 'The employee has no employment days in the selected month.',
    severity: 'month',
  },
};

export function exceptionLabel(code: string): string {
  return EXCEPTION_INFO[code as MonthExceptionCode]?.label ?? code;
}

export function exceptionTone(code: string): BadgeTone {
  const severity = EXCEPTION_INFO[code as MonthExceptionCode]?.severity;
  if (severity === 'blocking') return 'error';
  if (severity === 'warning') return 'warning';
  return 'muted';
}

export const COVERAGE_LABELS: Record<DayCoverage, string> = {
  NOT_EMPLOYED: 'Not employed',
  NO_SHIFT_ASSIGNMENT: 'No shift',
  NO_DAILY_SUMMARY: 'No record',
  SUMMARY: 'Recorded',
  NON_WORKING_DAY: 'Non-working day',
};

/** HR-POLICY-01 — working-calendar day classifications. */
export const DAY_CLASSIFICATION_LABELS: Record<string, string> = {
  NOT_EMPLOYED: 'Not employed',
  SCHEDULED_WORKDAY: 'Working day',
  REST_DAY: 'Rest day',
  PUBLIC_HOLIDAY: 'Public holiday',
  APPROVED_LEAVE: 'Approved leave',
  UNKNOWN: 'Unknown (no calendar)',
};

export const DAY_CLASSIFICATION_TONES: Record<string, BadgeTone> = {
  NOT_EMPLOYED: 'muted',
  SCHEDULED_WORKDAY: 'success',
  REST_DAY: 'muted',
  PUBLIC_HOLIDAY: 'info',
  APPROVED_LEAVE: 'info',
  UNKNOWN: 'error',
};

export const CALENDAR_NOTE_LABELS: Record<string, string> = {
  NO_CALENDAR_ASSIGNED: 'No approved calendar assigned',
  HOLIDAY_ON_REST_DAY: 'Holiday falls on a rest day (compensation rule pending)',
  WORKING_ON_PUBLIC_HOLIDAY: 'Required to work on a public holiday (compensation rule pending)',
  SCHEDULED_MINUTES_UNKNOWN: 'Shift length unknown (no valid shift)',
  OVERNIGHT_SHIFT_OWNERSHIP_PENDING: 'Overnight shift: counted on the start date (HR decision pending)',
  EMPLOYEE_CALENDAR_ASSIGNMENT_CONFLICT: 'Two different calendars assigned to the employee',
  SHIFT_CALENDAR_ASSIGNMENT_CONFLICT: 'Two different calendars assigned to the shift',
  SHIFT_ASSIGNMENT_AMBIGUOUS: 'Two shifts assigned on the same date',
  EMPLOYEE_DAY_OVERRIDE_CONFLICT: 'Conflicting employee day exceptions',
  CALENDAR_DAY_OVERRIDE_CONFLICT: 'Conflicting calendar day exceptions',
};

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SOURCE_LABELS: Record<string, string> = {
  MOBILE: 'Mobile',
  BIOMETRIC_DEVICE: 'Biometric',
  FACE_DEVICE: 'Face device',
  CARD_DEVICE: 'Card device',
  WEB: 'Web',
  MANUAL_CORRECTION: 'Manual correction',
  IMPORT: 'Import',
  FUTURE_INTEGRATION: 'Integration',
};

export function sourceLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return NOT_CALCULATED;
  return SOURCE_LABELS[sourceType] ?? sourceType;
}

const DAILY_STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  HALF_DAY: 'Half Day',
  LEAVE: 'Leave',
  WEEK_OFF: 'Week Off',
  HOLIDAY: 'Holiday',
  MISSING_PUNCH: 'Missing Punch',
};

const DAILY_STATUS_TONES: Record<string, BadgeTone> = {
  PRESENT: 'success',
  ABSENT: 'error',
  LATE: 'warning',
  HALF_DAY: 'warning',
  LEAVE: 'info',
  WEEK_OFF: 'muted',
  HOLIDAY: 'muted',
  MISSING_PUNCH: 'warning',
};

export function dailyStatusLabel(status: string): string {
  return DAILY_STATUS_LABELS[status] ?? status;
}

export function dailyStatusTone(status: string): BadgeTone {
  return DAILY_STATUS_TONES[status] ?? 'muted';
}

/** Minutes → "152h 30m". `null`/`undefined` → "—" (never "0h 0m" for unknown values). */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return NOT_CALCULATED;
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  if (hours === 0) return `${sign}${rest}m`;
  return rest === 0 ? `${sign}${hours.toLocaleString()}h` : `${sign}${hours.toLocaleString()}h ${rest}m`;
}

const KUWAIT_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuwait',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const KUWAIT_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuwait',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO instant → "07:02" in Kuwait time. */
export function formatKuwaitTime(iso: string | null | undefined): string {
  return iso ? KUWAIT_TIME.format(new Date(iso)) : NOT_CALCULATED;
}

export function formatKuwaitDateTime(iso: string | null | undefined): string {
  return iso ? `${KUWAIT_DATE_TIME.format(new Date(iso))} (Kuwait)` : NOT_CALCULATED;
}

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const LONG_DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "YYYY-MM-DD" work date (a calendar date, not an instant) → "Sun". */
export function weekdayOf(workDate: string): string {
  return WEEKDAY.format(new Date(`${workDate}T00:00:00Z`));
}

/** "YYYY-MM-DD" (or an ISO string whose date part is the work date) → "01 Feb 2026". */
export function formatWorkDate(value: string): string {
  return LONG_DATE.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

/** "YYYY-MM" → "February 2026". */
export function formatMonth(month: string): string {
  return MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`));
}

const MONTH_PATTERN = /^(20\d{2})-(0[1-9]|1[0-2])$/;

export function isValidMonth(value: string | null | undefined): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value);
}

/** Current calendar month in Kuwait (UTC+3, no DST). */
export function currentKuwaitMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** Calendar months ("YYYY-MM") overlapped by an inclusive work-date range. */
export function monthsInRange(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  let cursor = startDate.slice(0, 7);
  const last = endDate.slice(0, 7);
  while (cursor <= last && months.length < 24) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
}

/** Unit 21.1 — readiness-only codes (all others reuse EXCEPTION_INFO). */
const READINESS_ONLY_INFO: Record<string, { label: string; description: string }> = {
  WORK_CALENDAR_NOT_CONFIGURED: {
    label: 'Working day unknown (no calendar)',
    description:
      'No attendance and no approved working calendar for this day, so the system cannot tell a day off from an absence. Assign an approved calendar (Working Calendar → Calendars).',
  },
  MISSING_DAILY_SUMMARY: {
    label: 'Attendance not calculated',
    description: 'Punches exist for this day but no daily attendance record was calculated.',
  },
  DAILY_SUMMARY_STALE: {
    label: 'Attendance needs recalculation',
    description:
      'A punch, punch decision or shift changed after this day was calculated. Recalculate the day before closing.',
  },
  MISSING_IN: { label: 'Missing Check In', description: 'Only Check Out was recorded.' },
  MISSING_OUT: { label: 'Missing Check Out', description: 'Only Check In was recorded.' },
  UNRESOLVED_DEVICE_IMPORT: {
    label: 'Unresolved device / import punch',
    description: 'A biometric or imported punch is still waiting for review.',
  },
  NO_EMPLOYEES_IN_PERIOD: {
    label: 'No employees in this period',
    description: 'Nobody was employed during these dates, so there is nothing to verify or close.',
  },
  PERIOD_TOO_LONG: {
    label: 'Period too long to check',
    description: 'Readiness is only checked for periods of up to 92 days. Create shorter (monthly) periods.',
  },
};

export function readinessLabel(code: string): string {
  return READINESS_ONLY_INFO[code]?.label ?? exceptionLabel(code);
}

export function readinessDescription(code: string): string {
  return READINESS_ONLY_INFO[code]?.description ?? EXCEPTION_INFO[code as MonthExceptionCode]?.description ?? '';
}
