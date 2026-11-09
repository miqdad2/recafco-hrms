/**
 * HR-POLICY-01 — deterministic working-calendar resolver (pure, no database access).
 *
 * Answers, for one employee and one Kuwait calendar date: is this a scheduled working day, a
 * rest day, a public holiday, approved leave, or UNKNOWN? Only ACTIVE (approved) records reach
 * this function; DRAFT/INACTIVE records are filtered out by the loader and can never apply.
 *
 * Precedence (highest first) — documented in docs/architecture/shift-payroll-rules.md §5:
 *   1. Employment dates           → NOT_EMPLOYED outside hire..termination
 *   2. Approved leave             → APPROVED_LEAVE   (NOT INTEGRATED: no leave module exists)
 *   3. Employee day override      → WORKING_DAY / REST_DAY for that employee and date
 *   4. Public holiday (company)   → PUBLIC_HOLIDAY
 *   5. Calendar day override      → special working day / rest day on the employee's calendar
 *   6. Weekly pattern of the employee's calendar
 *        calendar = EMPLOYEE-scope assignment, else SHIFT-scope assignment of the effective shift
 *   7. Nothing applies            → UNKNOWN
 * Any conflict (two different answers at the same level) makes the day UNKNOWN with a conflict
 * code — the resolver never picks one unpredictably. Unknown never means zero minutes.
 */

export const CALENDAR_RESOLVER_VERSION = 'work-calendar-resolver/1';

/** No authoritative leave-approval workflow exists in the HRMS (audited in HR-POLICY-01). */
export const LEAVE_INTEGRATION_AVAILABLE = false;

export type DayClassification = 'NOT_EMPLOYED' | 'SCHEDULED_WORKDAY' | 'REST_DAY' | 'PUBLIC_HOLIDAY' | 'APPROVED_LEAVE' | 'UNKNOWN';

export const NON_WORKING_CLASSIFICATIONS: readonly DayClassification[] = ['REST_DAY', 'PUBLIC_HOLIDAY', 'APPROVED_LEAVE'];

export type ResolutionSource =
  | 'EMPLOYMENT_DATES'
  | 'EMPLOYEE_DAY_OVERRIDE'
  | 'PUBLIC_HOLIDAY'
  | 'CALENDAR_DAY_OVERRIDE'
  | 'EMPLOYEE_CALENDAR'
  | 'SHIFT_CALENDAR'
  | 'NONE';

export type CalendarConflictCode =
  | 'EMPLOYEE_CALENDAR_ASSIGNMENT_CONFLICT'
  | 'SHIFT_CALENDAR_ASSIGNMENT_CONFLICT'
  | 'SHIFT_ASSIGNMENT_AMBIGUOUS'
  | 'EMPLOYEE_DAY_OVERRIDE_CONFLICT'
  | 'CALENDAR_DAY_OVERRIDE_CONFLICT';

export type CalendarWarningCode =
  | 'NO_CALENDAR_ASSIGNED'
  | 'HOLIDAY_ON_REST_DAY'
  | 'WORKING_ON_PUBLIC_HOLIDAY'
  | 'SCHEDULED_MINUTES_UNKNOWN'
  | 'OVERNIGHT_SHIFT_OWNERSHIP_PENDING';

export interface CalendarFact {
  id: string;
  code: string;
  name: string;
  workingWeekdays: number[];
}
/** Inclusive Kuwait dates (YYYY-MM-DD). */
export interface CalendarAssignmentFact {
  id: string;
  calendarId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface DayOverrideFact {
  id: string;
  date: string;
  dayType: 'WORKING_DAY' | 'REST_DAY';
}
export interface HolidayFact {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

/** ACTIVE records only, pre-indexed once per request/chunk (never re-loaded per day). */
export interface CalendarContext {
  calendarsById: Map<string, CalendarFact>;
  employeeAssignments: Map<string, CalendarAssignmentFact[]>;
  shiftAssignments: Map<string, CalendarAssignmentFact[]>;
  calendarOverrides: Map<string, DayOverrideFact[]>;
  employeeOverrides: Map<string, DayOverrideFact[]>;
  holidays: HolidayFact[];
}

export const EMPTY_CALENDAR_CONTEXT: CalendarContext = {
  calendarsById: new Map(),
  employeeAssignments: new Map(),
  shiftAssignments: new Map(),
  calendarOverrides: new Map(),
  employeeOverrides: new Map(),
  holidays: [],
};

export interface CalendarDayInput {
  employeeId: string;
  date: string;
  employed: boolean;
  /** The effective shift for the date (Unit 20.2 selection); null if none. */
  shift: { id: string; overnight: boolean; durationMinutes: number | null } | null;
  shiftAmbiguous: boolean;
}

export interface CalendarDayResolution {
  classification: DayClassification;
  /** true/false when known; null when UNKNOWN or not employed. */
  scheduledWork: boolean | null;
  /** Minutes of scheduled work: shift duration on a working day, 0 on a verified non-working day, null when unknown. */
  scheduledMinutes: number | null;
  source: ResolutionSource;
  calendar: { id: string; code: string; name: string } | null;
  holiday: { id: string; name: string } | null;
  overrideId: string | null;
  policyVersion: string;
  warnings: CalendarWarningCode[];
  conflicts: CalendarConflictCode[];
}

const covers = (a: CalendarAssignmentFact, date: string) => a.effectiveFrom <= date && (a.effectiveTo === null || date <= a.effectiveTo);
const weekday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

/** One answer from a set of same-level overrides, or a conflict when they disagree. */
function pickOverride(list: DayOverrideFact[] | undefined, date: string): { override: DayOverrideFact | null; conflict: boolean } {
  const matches = (list ?? []).filter((o) => o.date === date);
  if (matches.length === 0) return { override: null, conflict: false };
  const types = new Set(matches.map((o) => o.dayType));
  return types.size > 1 ? { override: null, conflict: true } : { override: matches[0] as DayOverrideFact, conflict: false };
}

export function resolveCalendarDay(ctx: CalendarContext, input: CalendarDayInput): CalendarDayResolution {
  const warnings = new Set<CalendarWarningCode>();
  const conflicts = new Set<CalendarConflictCode>();
  const result = (r: Omit<CalendarDayResolution, 'policyVersion' | 'warnings' | 'conflicts'>): CalendarDayResolution => ({
    ...r,
    policyVersion: CALENDAR_RESOLVER_VERSION,
    warnings: [...warnings].sort(),
    conflicts: [...conflicts].sort(),
  });

  // 1. Employment dates.
  if (!input.employed) {
    return result({ classification: 'NOT_EMPLOYED', scheduledWork: false, scheduledMinutes: null, source: 'EMPLOYMENT_DATES', calendar: null, holiday: null, overrideId: null });
  }

  // 2. Approved leave: not integrated (LEAVE_INTEGRATION_AVAILABLE = false). Nothing is fabricated.

  // Effective calendar (needed by levels 5–6 and for holiday-on-rest-day reporting).
  let calendar: CalendarFact | null = null;
  let calendarSource: ResolutionSource = 'NONE';
  const employeeCal = (ctx.employeeAssignments.get(input.employeeId) ?? []).filter((a) => covers(a, input.date));
  if (employeeCal.length > 1 && new Set(employeeCal.map((a) => a.calendarId)).size > 1) {
    conflicts.add('EMPLOYEE_CALENDAR_ASSIGNMENT_CONFLICT');
  } else if (employeeCal.length >= 1) {
    calendar = ctx.calendarsById.get((employeeCal[0] as CalendarAssignmentFact).calendarId) ?? null;
    calendarSource = 'EMPLOYEE_CALENDAR';
  } else if (input.shiftAmbiguous) {
    conflicts.add('SHIFT_ASSIGNMENT_AMBIGUOUS');
  } else if (input.shift) {
    const shiftCal = (ctx.shiftAssignments.get(input.shift.id) ?? []).filter((a) => covers(a, input.date));
    if (shiftCal.length > 1 && new Set(shiftCal.map((a) => a.calendarId)).size > 1) {
      conflicts.add('SHIFT_CALENDAR_ASSIGNMENT_CONFLICT');
    } else if (shiftCal.length >= 1) {
      calendar = ctx.calendarsById.get((shiftCal[0] as CalendarAssignmentFact).calendarId) ?? null;
      calendarSource = 'SHIFT_CALENDAR';
    }
  }
  if (!calendar && conflicts.size === 0) warnings.add('NO_CALENDAR_ASSIGNED');
  const calendarRef = calendar ? { id: calendar.id, code: calendar.code, name: calendar.name } : null;
  const weeklyWorking = calendar ? calendar.workingWeekdays.includes(weekday(input.date)) : null;

  const employeeOverride = pickOverride(ctx.employeeOverrides.get(input.employeeId), input.date);
  if (employeeOverride.conflict) conflicts.add('EMPLOYEE_DAY_OVERRIDE_CONFLICT');
  const calendarOverride = calendar ? pickOverride(ctx.calendarOverrides.get(calendar.id), input.date) : { override: null, conflict: false };
  if (calendarOverride.conflict) conflicts.add('CALENDAR_DAY_OVERRIDE_CONFLICT');

  // Any conflict → UNKNOWN (fail closed, never an arbitrary choice).
  if (conflicts.size > 0) {
    return result({ classification: 'UNKNOWN', scheduledWork: null, scheduledMinutes: null, source: 'NONE', calendar: calendarRef, holiday: null, overrideId: null });
  }

  const holidayFact = ctx.holidays.find((h) => h.startDate <= input.date && input.date <= h.endDate) ?? null;
  const holiday = holidayFact ? { id: holidayFact.id, name: holidayFact.name } : null;

  const working = (source: ResolutionSource, overrideId: string | null): CalendarDayResolution => {
    let minutes: number | null = null;
    if (input.shift && !input.shiftAmbiguous && input.shift.durationMinutes !== null) minutes = input.shift.durationMinutes;
    else warnings.add('SCHEDULED_MINUTES_UNKNOWN');
    if (input.shift?.overnight) warnings.add('OVERNIGHT_SHIFT_OWNERSHIP_PENDING');
    if (holiday) warnings.add('WORKING_ON_PUBLIC_HOLIDAY');
    return result({ classification: 'SCHEDULED_WORKDAY', scheduledWork: true, scheduledMinutes: minutes, source, calendar: calendarRef, holiday, overrideId });
  };
  const nonWorking = (classification: DayClassification, source: ResolutionSource, overrideId: string | null): CalendarDayResolution =>
    result({ classification, scheduledWork: false, scheduledMinutes: 0, source, calendar: calendarRef, holiday, overrideId });

  // 3. Employee day override.
  if (employeeOverride.override) {
    return employeeOverride.override.dayType === 'WORKING_DAY'
      ? working('EMPLOYEE_DAY_OVERRIDE', employeeOverride.override.id)
      : nonWorking('REST_DAY', 'EMPLOYEE_DAY_OVERRIDE', employeeOverride.override.id);
  }
  // 4. Public holiday (company-wide). Applies even to employees without a calendar.
  if (holiday) {
    if (weeklyWorking === false) warnings.add('HOLIDAY_ON_REST_DAY');
    return nonWorking('PUBLIC_HOLIDAY', 'PUBLIC_HOLIDAY', null);
  }
  // 5. Calendar day override.
  if (calendarOverride.override) {
    return calendarOverride.override.dayType === 'WORKING_DAY'
      ? working('CALENDAR_DAY_OVERRIDE', calendarOverride.override.id)
      : nonWorking('REST_DAY', 'CALENDAR_DAY_OVERRIDE', calendarOverride.override.id);
  }
  // 6. Weekly pattern.
  if (calendar) {
    return weeklyWorking ? working(calendarSource, null) : nonWorking('REST_DAY', calendarSource, null);
  }
  // 7. Unknown.
  return result({ classification: 'UNKNOWN', scheduledWork: null, scheduledMinutes: null, source: 'NONE', calendar: null, holiday: null, overrideId: null });
}
