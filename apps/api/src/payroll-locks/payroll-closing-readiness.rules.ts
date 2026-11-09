/**
 * Unit 21.1 — payroll-closing readiness rules (pure, no database access).
 *
 * Readiness answers ONE question: can this exact date range be locked without freezing
 * attendance that could produce wrong payroll figures? It is fail-closed: anything unknown or
 * unresolved blocks. A READY result is NOT payroll approval.
 *
 * Day-level evaluation reuses the Unit 20.2 calculator (`DailyBreakdown`) and then sharpens it
 * with readiness-only facts (punch eligibility/source/staleness). See
 * docs/architecture/shift-payroll-rules.md §4.
 */
import type { DailyBreakdown } from '../payroll-attendance/monthly-attendance.calculator';
import { NON_WORKING_CLASSIFICATIONS } from '../work-calendars/work-calendar.resolver';

export const READINESS_RULES_VERSION = 'payroll-closing-readiness/2';

/** Maximum period length readiness will evaluate. Longer periods fail closed (PERIOD_TOO_LONG). */
export const MAX_READINESS_PERIOD_DAYS = 92;

/** Detailed employee/day issues returned by the API (aggregate counts are always complete). */
export const READINESS_SAMPLE_LIMIT = 50;

export const BLOCKING_READINESS_DAY_CODES = [
  // Shift
  'NO_SHIFT_ASSIGNMENT',
  'SHIFT_ASSIGNMENT_AMBIGUOUS',
  'SHIFT_CONFIGURATION_INVALID',
  'SHIFT_INACTIVE',
  'OVERNIGHT_SHIFT_CALENDAR_SPLIT',
  // Coverage / working calendar (HR-POLICY-01)
  'WORK_CALENDAR_NOT_CONFIGURED',
  'WORK_CALENDAR_CONFLICT',
  'SCHEDULED_DAY_NO_ATTENDANCE',
  'WORK_ON_NON_WORKING_DAY',
  'MISSING_DAILY_SUMMARY',
  'DAILY_SUMMARY_STALE',
  // Punch data
  'MISSING_IN',
  'MISSING_OUT',
  'OUT_BEFORE_IN',
  'ABSENT_NOT_HR_CONFIRMED',
  // Pending work
  'PENDING_REVIEW_PUNCHES',
  'UNRESOLVED_DEVICE_IMPORT',
  'PENDING_CORRECTION',
  // Policy not applied by the daily calculator (HR decisions D1/D2)
  'BREAK_NOT_APPLIED',
  'GRACE_NOT_APPLIED',
] as const;

export const WARNING_READINESS_DAY_CODES = ['REJECTED_PUNCHES', 'LOCKED_PERIOD_LATE_PUNCH'] as const;

export const PERIOD_READINESS_CODES = ['NO_EMPLOYEES_IN_PERIOD', 'PERIOD_TOO_LONG'] as const;

export type ReadinessDayCode = (typeof BLOCKING_READINESS_DAY_CODES)[number] | (typeof WARNING_READINESS_DAY_CODES)[number];
export type ReadinessPeriodCode = (typeof PERIOD_READINESS_CODES)[number];
export type ReadinessSeverity = 'BLOCKING' | 'WARNING';

export function severityOf(code: ReadinessDayCode | ReadinessPeriodCode): ReadinessSeverity {
  return (WARNING_READINESS_DAY_CODES as readonly string[]).includes(code) ? 'WARNING' : 'BLOCKING';
}

/** Source types whose unresolved (pending) punches count as unresolved device/import events. */
export const DEVICE_IMPORT_SOURCE_TYPES = ['BIOMETRIC_DEVICE', 'FACE_DEVICE', 'CARD_DEVICE', 'IMPORT', 'FUTURE_INTEGRATION'] as const;

/** Readiness-only facts for one employee/work date (from one bulk SQL aggregate). */
export interface ReadinessDayFacts {
  /** ACCEPTED / ACCEPTED_WITH_WARNING punches (the ones the daily calculator uses). */
  eligiblePunches: number;
  pendingDevicePunches: number;
  pendingOtherPunches: number;
  /**
   * The stored summary does not reflect the current inputs: its official IN/OUT differ from the
   * earliest eligible IN / latest eligible OUT of the day (the daily calculator's selection
   * rule), an official punch is no longer eligible, or a covering shift/assignment changed after
   * the summary's calculatedAt.
   */
  summaryStale: boolean;
}

const EMPTY_FACTS: ReadinessDayFacts = { eligiblePunches: 0, pendingDevicePunches: 0, pendingOtherPunches: 0, summaryStale: false };

/** 20.2 codes that readiness replaces with more precise ones. */
const REPLACED_CODES = new Set(['MISSING_PUNCH', 'MISSING_DAILY_SUMMARY', 'PENDING_REVIEW_PUNCHES']);

/**
 * Readiness codes for one employee/day. Each code appears at most once per day, so aggregate
 * counts are "employee-days affected" and an issue is never double counted.
 */
export function readinessCodesForDay(day: DailyBreakdown, facts: ReadinessDayFacts | undefined): ReadinessDayCode[] {
  if (day.coverage === 'NOT_EMPLOYED') return [];
  const f = facts ?? EMPTY_FACTS;
  const codes = new Set<ReadinessDayCode>();

  for (const code of day.exceptions) {
    if (!REPLACED_CODES.has(code)) codes.add(code as ReadinessDayCode);
  }

  const hasSummary = day.attendanceStatus !== null;
  const classification = day.calendar.classification;
  const nonWorking = NON_WORKING_CLASSIFICATIONS.includes(classification);
  const hasPunches = f.eligiblePunches > 0 || f.pendingDevicePunches > 0 || f.pendingOtherPunches > 0;
  if (hasSummary) {
    if (day.attendanceStatus === 'MISSING_PUNCH') {
      if (!day.officialIn) codes.add('MISSING_IN');
      if (!day.officialOut) codes.add('MISSING_OUT');
    }
    if (f.summaryStale) codes.add('DAILY_SUMMARY_STALE');
  } else if (hasPunches) {
    // Punches exist but no daily summary was calculated (this IS attendance, so it is not
    // "scheduled day without attendance"; on a non-working day it is also work on that day).
    codes.delete('SCHEDULED_DAY_NO_ATTENDANCE');
    codes.add('MISSING_DAILY_SUMMARY');
    if (nonWorking) codes.add('WORK_ON_NON_WORKING_DAY');
  } else if (nonWorking) {
    // HR-POLICY-01: a VERIFIED rest day / public holiday / approved leave day with no activity is
    // resolved — it no longer blocks merely because it has no punch.
  } else if (classification === 'SCHEDULED_WORKDAY') {
    // SCHEDULED_DAY_NO_ATTENDANCE comes from the day evaluation: absence vs unrecorded leave is
    // unresolved. Blocks; never converted to an absence or a deduction.
  } else if (day.calendar.conflicts.length === 0) {
    // UNKNOWN: no approved calendar applies. Fail closed; never assume absence or a day off.
    codes.add('WORK_CALENDAR_NOT_CONFIGURED');
  }

  if (f.pendingDevicePunches > 0) codes.add('UNRESOLVED_DEVICE_IMPORT');
  if (f.pendingOtherPunches > 0) codes.add('PENDING_REVIEW_PUNCHES');

  return [...codes].sort();
}

export interface ReadinessIssueType {
  severity: ReadinessSeverity;
  /** Employee-days with this issue (period-level codes: 1). */
  employeeDays: number;
  employees: number;
}

export interface ReadinessSampleIssue {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  workDate: string;
  codes: ReadinessDayCode[];
}

export interface PayrollClosingReadiness {
  rulesVersion: string;
  periodId: string;
  periodStatus: string;
  periodStart: string;
  periodEnd: string;
  calendarDays: number;
  /** NOT payroll approval — only "no known blocker exists". */
  ready: boolean;
  employeesEvaluated: number;
  /** Employment days evaluated (employees × their employed days in the period). */
  employeeDaysEvaluated: number;
  /** Always false until a working calendar exists: scheduled working days are unknown. */
  scheduledWorkingDaysKnown: false;
  /** Sum over blocking codes of affected employee-days, plus period-level blockers. */
  blockingIssueCount: number;
  warningCount: number;
  affectedEmployees: number;
  affectedEmployeeDays: number;
  periodIssues: ReadinessPeriodCode[];
  issuesByType: Partial<Record<ReadinessDayCode | ReadinessPeriodCode, ReadinessIssueType>>;
  sampleIssues: ReadinessSampleIssue[];
  sampleLimit: number;
  sampleTruncated: boolean;
  evaluatedAt: string;
}

/** Incremental aggregation so 2,000 employees never need to be held in memory at once. */
export class ReadinessAccumulator {
  private readonly byType = new Map<string, { severity: ReadinessSeverity; employeeDays: number; employees: Set<string> }>();
  private readonly affected = new Set<string>();
  private affectedDays = 0;
  private readonly samples: ReadinessSampleIssue[] = [];
  private sampleOverflow = false;
  employeesEvaluated = 0;
  employeeDaysEvaluated = 0;
  readonly periodIssues: ReadinessPeriodCode[] = [];

  addEmployee(employee: { id: string; employeeCode: string; name: string }, days: { workDate: string; employed: boolean; codes: ReadinessDayCode[] }[]): void {
    this.employeesEvaluated += 1;
    for (const day of days) {
      if (!day.employed) continue;
      this.employeeDaysEvaluated += 1;
      if (day.codes.length === 0) continue;
      let dayBlocking = false;
      for (const code of day.codes) {
        const severity = severityOf(code);
        if (severity === 'BLOCKING') dayBlocking = true;
        const entry = this.byType.get(code) ?? { severity, employeeDays: 0, employees: new Set<string>() };
        entry.employeeDays += 1;
        entry.employees.add(employee.id);
        this.byType.set(code, entry);
      }
      if (dayBlocking) {
        this.affectedDays += 1;
        this.affected.add(employee.id);
      }
      if (this.samples.length < READINESS_SAMPLE_LIMIT) {
        this.samples.push({ employeeId: employee.id, employeeCode: employee.employeeCode, employeeName: employee.name, workDate: day.workDate, codes: day.codes });
      } else {
        this.sampleOverflow = true;
      }
    }
  }

  addPeriodIssue(code: ReadinessPeriodCode): void {
    if (!this.periodIssues.includes(code)) this.periodIssues.push(code);
  }

  finish(base: Pick<PayrollClosingReadiness, 'periodId' | 'periodStatus' | 'periodStart' | 'periodEnd' | 'calendarDays'>, evaluatedAt: Date): PayrollClosingReadiness {
    const issuesByType: PayrollClosingReadiness['issuesByType'] = {};
    let blocking = 0;
    let warnings = 0;
    for (const [code, entry] of [...this.byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      issuesByType[code as ReadinessDayCode] = { severity: entry.severity, employeeDays: entry.employeeDays, employees: entry.employees.size };
      if (entry.severity === 'BLOCKING') blocking += entry.employeeDays;
      else warnings += entry.employeeDays;
    }
    for (const code of this.periodIssues) {
      issuesByType[code] = { severity: 'BLOCKING', employeeDays: 1, employees: 0 };
      blocking += 1;
    }
    return {
      rulesVersion: READINESS_RULES_VERSION,
      ...base,
      ready: blocking === 0,
      employeesEvaluated: this.employeesEvaluated,
      employeeDaysEvaluated: this.employeeDaysEvaluated,
      scheduledWorkingDaysKnown: false,
      blockingIssueCount: blocking,
      warningCount: warnings,
      affectedEmployees: this.affected.size,
      affectedEmployeeDays: this.affectedDays,
      periodIssues: [...this.periodIssues],
      issuesByType,
      sampleIssues: this.samples,
      sampleLimit: READINESS_SAMPLE_LIMIT,
      sampleTruncated: this.sampleOverflow,
      evaluatedAt: evaluatedAt.toISOString(),
    };
  }
}

/** Only for typing the per-day loop: re-export so the service need not import the calculator twice. */
export type { DailyBreakdown };
