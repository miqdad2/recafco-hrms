import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AttendancePayrollLock } from '@recafco/db';
import { DatabaseService } from '../database/database.service';
import { parseDateRange, type MonthPeriod } from '../payroll-attendance/monthly-attendance.calculator';
import { EMPLOYEE_SELECT, PayrollAttendanceService, type Tx } from '../payroll-attendance/payroll-attendance.service';
import {
  DEVICE_IMPORT_SOURCE_TYPES,
  MAX_READINESS_PERIOD_DAYS,
  ReadinessAccumulator,
  readinessCodesForDay,
  type PayrollClosingReadiness,
  type ReadinessDayFacts,
} from './payroll-closing-readiness.rules';

/** Employees per bulk-load chunk (same as the Unit 20.2 aggregate). */
const CHUNK_SIZE = 250;

const toSqlTimestamp = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Unit 21.1 — evaluates whether an exact payroll-lock date range can safely be locked.
 *
 * `evaluate(tx, lock)` is a pure read over the given transaction, so the SAME code runs:
 *  - for `GET /payroll-locks/:id/readiness` inside a `REPEATABLE READ, READ ONLY` snapshot, and
 *  - inside `PayrollLocksService.lockPeriod`'s transaction, after the period row is locked
 *    `FOR UPDATE`, so the decision and the LOCKED transition commit atomically.
 *
 * Fixed number of queries per 250-employee chunk (no N+1); bounded detail in the response.
 */
@Injectable()
export class PayrollClosingReadinessService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly payrollAttendanceService: PayrollAttendanceService,
  ) {}

  /** Read-only snapshot evaluation for the readiness endpoint. */
  async evaluateById(id: string): Promise<PayrollClosingReadiness> {
    return this.databaseService.client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const lock = await tx.attendancePayrollLock.findUnique({ where: { id } });
        if (!lock) {
          throw new NotFoundException('Payroll lock period not found');
        }
        return this.evaluate(tx, lock);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 },
    );
  }

  async evaluate(tx: Tx, lock: Pick<AttendancePayrollLock, 'id' | 'status' | 'periodStart' | 'periodEnd'>): Promise<PayrollClosingReadiness> {
    const period = parseDateRange(dateOnly(lock.periodStart), dateOnly(lock.periodEnd));
    const base = {
      periodId: lock.id,
      periodStatus: lock.status,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      calendarDays: period.dates.length,
    };
    const acc = new ReadinessAccumulator();

    if (period.dates.length > MAX_READINESS_PERIOD_DAYS) {
      acc.addPeriodIssue('PERIOD_TOO_LONG');
      return acc.finish(base, new Date());
    }

    const where = this.payrollAttendanceService.employeeWhere({}, period);
    // Other LOCKED periods only matter for the LOCKED_PERIOD_LATE_PUNCH warning; this period
    // itself is OPEN/REOPENED while being evaluated.
    const lockedDates = await this.payrollAttendanceService.lockedDates(tx, period);

    for (let skip = 0; ; skip += CHUNK_SIZE) {
      const employees = await tx.employee.findMany({
        where,
        select: EMPLOYEE_SELECT,
        orderBy: [{ employeeCode: 'asc' }, { id: 'asc' }],
        skip,
        take: CHUNK_SIZE,
      });
      if (employees.length === 0) break;
      const ids = employees.map((e) => e.id);
      const results = await this.payrollAttendanceService.calculateMonths(tx, employees, period, lockedDates);
      const facts = await this.loadFacts(tx, ids, period);

      for (const result of results) {
        acc.addEmployee(
          { id: result.employee.id, employeeCode: result.employee.employeeCode, name: result.employee.name },
          result.dailyBreakdown.map((day) => ({
            workDate: day.workDate,
            employed: day.coverage !== 'NOT_EMPLOYED',
            codes: readinessCodesForDay(day, facts.get(`${result.employee.id}|${day.workDate}`)),
          })),
        );
      }
      if (employees.length < CHUNK_SIZE) break;
    }

    if (acc.employeesEvaluated === 0) {
      // Nothing can be verified, so nothing should be locked.
      acc.addPeriodIssue('NO_EMPLOYEES_IN_PERIOD');
    }
    return acc.finish(base, new Date());
  }

  /**
   * Readiness-only facts per employee/work date, in ONE bulk SQL statement per chunk that
   * returns only the employee-days with something to report (normally very few), so 2,000
   * employees never means parsing tens of thousands of uneventful rows in Node.
   *
   * Freshness is checked by CONTENT, not by clocks: the daily calculator's official IN is the
   * earliest eligible IN and its official OUT the latest eligible OUT (same Kuwait day), so a
   * stored summary is stale when it no longer matches that selection or references a punch that
   * is no longer eligible. (Timestamp comparison was rejected: Prisma/PostgreSQL and Node use
   * clocks of different granularity on Windows, and a punch committing during a recalculation
   * could carry an earlier timestamp than the summary it is missing from.) Shift/assignment
   * edits leave no content trace in the summary, so those alone compare updatedAt > calculatedAt.
   */
  private async loadFacts(tx: Tx, ids: string[], period: MonthPeriod): Promise<Map<string, ReadinessDayFacts>> {
    const deviceSources = [...DEVICE_IMPORT_SOURCE_TYPES];
    const rows = await tx.$queryRaw<
      { employee_id: string; work_date: string; eligible: number; pending_device: number; pending_other: number; stale: boolean }[]
    >`
      WITH p AS (
        SELECT "employeeId" AS employee_id,
               to_char("punchTimeSource" + interval '3 hours', 'YYYY-MM-DD') AS work_date,
               count(*) FILTER (WHERE "validationStatus" IN ('ACCEPTED', 'ACCEPTED_WITH_WARNING'))::int AS eligible,
               count(*) FILTER (WHERE "validationStatus" IN ('PENDING_HR_REVIEW', 'PENDING_MANAGER_APPROVAL')
                                  AND "sourceType"::text = ANY(${deviceSources}::text[]))::int AS pending_device,
               count(*) FILTER (WHERE "validationStatus" IN ('PENDING_HR_REVIEW', 'PENDING_MANAGER_APPROVAL')
                                  AND NOT ("sourceType"::text = ANY(${deviceSources}::text[])))::int AS pending_other,
               min("punchTimeSource") FILTER (WHERE "validationStatus" IN ('ACCEPTED', 'ACCEPTED_WITH_WARNING') AND "punchType" = 'IN') AS expected_in,
               max("punchTimeSource") FILTER (WHERE "validationStatus" IN ('ACCEPTED', 'ACCEPTED_WITH_WARNING') AND "punchType" = 'OUT') AS expected_out
        FROM attendance_raw_punches
        WHERE "employeeId" = ANY(${ids}::text[])
          AND "punchTimeSource" >= ${toSqlTimestamp(period.rangeStartUtc)}::timestamp
          AND "punchTimeSource" < ${toSqlTimestamp(period.rangeEndUtc)}::timestamp
        GROUP BY 1, 2
      ),
      s AS (
        SELECT s."employeeId" AS employee_id,
               to_char(s."workDate", 'YYYY-MM-DD') AS work_date,
               CASE WHEN s."officialInPunchId" IS NULL THEN NULL ELSE s."officialInTime" END AS in_time,
               CASE WHEN s."officialOutPunchId" IS NULL THEN NULL ELSE s."officialOutTime" END AS out_time,
               (s."officialInPunchId" IS NOT NULL AND COALESCE(pin."validationStatus"::text, '') NOT IN ('ACCEPTED', 'ACCEPTED_WITH_WARNING'))
                 OR (s."officialOutPunchId" IS NOT NULL AND COALESCE(pout."validationStatus"::text, '') NOT IN ('ACCEPTED', 'ACCEPTED_WITH_WARNING'))
                 AS official_ineligible,
               EXISTS (
                 SELECT 1 FROM shift_assignments a JOIN shifts sh ON sh.id = a."shiftId"
                 WHERE a."employeeId" = s."employeeId"
                   AND a."effectiveFrom" < s."workDate" + interval '21 hours'
                   AND (a."effectiveTo" IS NULL OR a."effectiveTo" >= s."workDate" - interval '3 hours')
                   AND GREATEST(a."updatedAt", sh."updatedAt") > s."calculatedAt"
               ) AS shift_changed
        FROM attendance_daily_summaries s
        LEFT JOIN attendance_raw_punches pin ON pin.id = s."officialInPunchId"
        LEFT JOIN attendance_raw_punches pout ON pout.id = s."officialOutPunchId"
        WHERE s."employeeId" = ANY(${ids}::text[])
          AND s."workDate" >= ${`${period.periodStart} 00:00:00`}::timestamp
          AND s."workDate" <= ${`${period.periodEnd} 00:00:00`}::timestamp
      ),
      j AS (
        SELECT COALESCE(p.employee_id, s.employee_id) AS employee_id,
               COALESCE(p.work_date, s.work_date) AS work_date,
               COALESCE(p.eligible, 0) AS eligible,
               COALESCE(p.pending_device, 0) AS pending_device,
               COALESCE(p.pending_other, 0) AS pending_other,
               s.employee_id IS NOT NULL AS has_summary,
               (s.employee_id IS NOT NULL AND (
                  s.official_ineligible OR s.shift_changed
                  OR s.in_time IS DISTINCT FROM p.expected_in
                  OR s.out_time IS DISTINCT FROM p.expected_out)) AS stale
        FROM p FULL OUTER JOIN s ON s.employee_id = p.employee_id AND s.work_date = p.work_date
      )
      SELECT employee_id, work_date, eligible, pending_device, pending_other, stale
      FROM j
      WHERE pending_device > 0 OR pending_other > 0 OR stale OR (NOT has_summary AND eligible > 0)`;

    const facts = new Map<string, ReadinessDayFacts>();
    for (const row of rows) {
      facts.set(`${row.employee_id}|${row.work_date}`, {
        eligiblePunches: row.eligible,
        pendingDevicePunches: row.pending_device,
        pendingOtherPunches: row.pending_other,
        summaryStale: row.stale,
      });
    }
    return facts;
  }
}
