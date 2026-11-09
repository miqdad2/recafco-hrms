import { Injectable, NotFoundException } from '@nestjs/common';
import { CorrectionStatus, PayrollLockStatus, Prisma } from '@recafco/db';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { DatabaseService } from '../database/database.service';
import { loadCalendarContext } from '../work-calendars/work-calendar.loader';
import type { MonthlyAttendanceFilterDto, MonthlyAttendanceListQueryDto } from './dto/monthly-attendance.query.dto';
import {
  calculateEmployeeMonth,
  MONTHLY_ATTENDANCE_RULES_VERSION,
  parseMonth,
  type AssignmentFact,
  type EmployeeFact,
  type EmployeeMonthResult,
  type MonthPeriod,
  type MonthlyReviewStatus,
  type PunchCountsFact,
  type SummaryFact,
} from './monthly-attendance.calculator';

/** Employees per bulk-load chunk for the company-wide aggregate. */
const AGGREGATE_CHUNK_SIZE = 250;

export const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  status: true,
  hireDate: true,
  terminationDate: true,
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, title: true } },
  workLocation: { select: { id: true, name: true, code: true } },
} satisfies Prisma.EmployeeSelect;

export type Tx = Prisma.TransactionClient;
export type MonthlyEmployeeRecord = Omit<EmployeeMonthResult, 'dailyBreakdown'>;

/**
 * Read-only monthly attendance payroll basis (Unit 20.2). Never writes, never recalculates
 * summaries, never computes money. Every request runs inside ONE `REPEATABLE READ, READ ONLY`
 * transaction, so totals and exception counts come from a single consistent snapshot and the
 * database itself rejects any accidental write.
 */
@Injectable()
export class PayrollAttendanceService {
  constructor(private readonly databaseService: DatabaseService) {}

  private snapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.databaseService.client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return fn(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 60_000 },
    );
  }

  /** Employees employed at any point in the period, matching the filters. Soft-deactivated
   * employees are included when their employment dates overlap (final-month payroll needs them). */
  employeeWhere(filter: Pick<MonthlyAttendanceFilterDto, 'employeeId' | 'departmentId' | 'workLocationId'>, period: MonthPeriod): Prisma.EmployeeWhereInput {
    return {
      ...(filter.employeeId ? { id: filter.employeeId } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.workLocationId ? { workLocationId: filter.workLocationId } : {}),
      hireDate: { lte: new Date(`${period.periodEnd}T00:00:00.000Z`) },
      OR: [{ terminationDate: null }, { terminationDate: { gte: new Date(`${period.periodStart}T00:00:00.000Z`) } }],
    };
  }

  async listMonthly(query: MonthlyAttendanceListQueryDto): Promise<PaginatedResult<MonthlyEmployeeRecord> & { rulesVersion: string }> {
    const period = parseMonth(query.month);
    return this.snapshot(async (tx) => {
      const where = this.employeeWhere(query, period);
      const total = await tx.employee.count({ where });
      const employees = await tx.employee.findMany({
        where,
        select: EMPLOYEE_SELECT,
        orderBy: [{ employeeCode: 'asc' }, { id: 'asc' }],
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
      });
      const lockedDates = await this.lockedDates(tx, period);
      const results = await this.calculateMonths(tx, employees, period, lockedDates);
      const rows = results.map(({ dailyBreakdown: _omit, ...rest }) => rest);
      return { ...paginate(rows, total, query.page, query.limit), rulesVersion: MONTHLY_ATTENDANCE_RULES_VERSION };
    });
  }

  async employeeMonth(employeeId: string, month: string): Promise<EmployeeMonthResult> {
    const period = parseMonth(month);
    return this.snapshot(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: EMPLOYEE_SELECT });
      if (!employee) {
        throw new NotFoundException('Employee not found');
      }
      const lockedDates = await this.lockedDates(tx, period);
      const [result] = await this.calculateMonths(tx, [employee], period, lockedDates);
      return result as EmployeeMonthResult;
    });
  }

  /** Totals over ALL matching employees (not one page), processed in bounded chunks within one snapshot. */
  async summary(filter: MonthlyAttendanceFilterDto) {
    const period = parseMonth(filter.month);
    return this.snapshot(async (tx) => {
      const where = this.employeeWhere(filter, period);
      const lockedDates = await this.lockedDates(tx, period);
      const statusCounts: Record<MonthlyReviewStatus, number> = { CALCULATED: 0, NEEDS_REVIEW: 0, INCOMPLETE: 0, LOCKED: 0 };
      const totals = {
        requiredMinutesDeterminable: 0,
        recordedWorkedMinutes: 0,
        verifiedWorkedMinutes: 0,
        verifiedShortageMinutes: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutesInformational: 0,
      };
      const days: Record<string, number> = {};
      const exceptionDayCounts: Record<string, number> = {};
      const exceptionCounters = { pendingReviewPunches: 0, rejectedPunches: 0, pendingCorrections: 0 };
      const employeesByException: Record<string, number> = {};
      let employeeCount = 0;
      let allRequiredKnown = true;
      let allShortageKnown = true;
      let requiredMinutes = 0;
      let shortageMinutes = 0;
      let allScheduledKnown = true;
      let scheduledWorkingDays = 0;

      for (let skip = 0; ; skip += AGGREGATE_CHUNK_SIZE) {
        const employees = await tx.employee.findMany({
          where,
          select: EMPLOYEE_SELECT,
          orderBy: [{ employeeCode: 'asc' }, { id: 'asc' }],
          skip,
          take: AGGREGATE_CHUNK_SIZE,
        });
        if (employees.length === 0) break;
        for (const r of await this.calculateMonths(tx, employees, period, lockedDates)) {
          employeeCount += 1;
          statusCounts[r.reviewStatus] += 1;
          for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += r.totals[key];
          if (r.totals.requiredMinutes === null) allRequiredKnown = false;
          else requiredMinutes += r.totals.requiredMinutes;
          if (r.totals.shortageMinutes === null) allShortageKnown = false;
          else shortageMinutes += r.totals.shortageMinutes;
          if (r.days.scheduledWorkingDays === null) allScheduledKnown = false;
          else scheduledWorkingDays += r.days.scheduledWorkingDays;
          for (const [key, value] of Object.entries(r.days)) {
            if (typeof value === 'number') days[key] = (days[key] ?? 0) + value;
          }
          for (const [code, value] of Object.entries(r.exceptions.dayCountsByCode)) {
            exceptionDayCounts[code] = (exceptionDayCounts[code] ?? 0) + (value ?? 0);
          }
          for (const code of r.exceptions.codes) employeesByException[code] = (employeesByException[code] ?? 0) + 1;
          exceptionCounters.pendingReviewPunches += r.exceptions.pendingReviewPunches;
          exceptionCounters.rejectedPunches += r.exceptions.rejectedPunches;
          exceptionCounters.pendingCorrections += r.exceptions.pendingCorrections;
        }
        if (employees.length < AGGREGATE_CHUNK_SIZE) break;
      }

      return {
        rulesVersion: MONTHLY_ATTENDANCE_RULES_VERSION,
        period: { month: period.month, periodStart: period.periodStart, periodEnd: period.periodEnd, calendarDays: period.dates.length },
        filters: {
          employeeId: filter.employeeId ?? null,
          departmentId: filter.departmentId ?? null,
          workLocationId: filter.workLocationId ?? null,
        },
        employeeCount,
        reviewStatusCounts: statusCounts,
        /** true only when every employee is CALCULATED — still not payroll approval. */
        allEmployeesCalculated: employeeCount > 0 && statusCounts.CALCULATED === employeeCount,
        totals: {
          ...totals,
          requiredMinutes: allRequiredKnown && employeeCount > 0 ? requiredMinutes : null,
          shortageMinutes: allShortageKnown && employeeCount > 0 ? shortageMinutes : null,
        },
        days: { ...days, scheduledWorkingDays: allScheduledKnown && employeeCount > 0 ? scheduledWorkingDays : null },
        exceptions: { dayCountsByCode: exceptionDayCounts, employeesByCode: employeesByException, ...exceptionCounters },
        payrollLock: { overlapsLockedPeriod: lockedDates.size > 0, lockedDates: [...lockedDates].sort() },
      };
    });
  }

  async lockedDates(tx: Tx, period: MonthPeriod): Promise<Set<string>> {
    const locks = await tx.attendancePayrollLock.findMany({
      where: {
        status: PayrollLockStatus.LOCKED,
        periodStart: { lte: new Date(`${period.periodEnd}T00:00:00.000Z`) },
        periodEnd: { gte: new Date(`${period.periodStart}T00:00:00.000Z`) },
      },
      select: { periodStart: true, periodEnd: true },
    });
    const locked = new Set<string>();
    for (const date of period.dates) {
      const d = Date.parse(`${date}T00:00:00.000Z`);
      if (locks.some((l) => l.periodStart.getTime() <= d && l.periodEnd.getTime() >= d)) locked.add(date);
    }
    return locked;
  }

  /**
   * Bulk-loads every fact for a set of employees with a FIXED number of queries (no N+1):
   * summaries, shift assignments, pending corrections, and one SQL aggregate of punch counts.
   */
  async calculateMonths(
    tx: Tx,
    employees: EmployeeFact[],
    period: MonthPeriod,
    lockedDates: Set<string>,
  ): Promise<EmployeeMonthResult[]> {
    if (employees.length === 0) return [];
    const ids = employees.map((e) => e.id);
    const firstDate = new Date(`${period.periodStart}T00:00:00.000Z`);
    const lastDate = new Date(`${period.periodEnd}T00:00:00.000Z`);

    // One explicit join instead of Prisma relation loading: relation includes issue two extra
    // queries per chunk with ~7,000-id IN lists, which dominated the aggregate's runtime
    // (measured: 9.3 s for 2,000 employees). Dates are formatted in SQL so the session TimeZone
    // can never shift a work date.
    const summaries = await tx.$queryRaw<
      {
        employee_id: string;
        work_date: string;
        status: string;
        official_in_punch_id: string | null;
        official_out_punch_id: string | null;
        official_in_time: Date | null;
        official_out_time: Date | null;
        total_worked_minutes: number;
        late_minutes: number;
        early_leave_minutes: number;
        overtime_minutes: number;
        locked_at: Date | null;
        in_source: string | null;
        out_source: string | null;
      }[]
    >`
      SELECT s."employeeId" AS employee_id,
             to_char(s."workDate", 'YYYY-MM-DD') AS work_date,
             s.status::text AS status,
             s."officialInPunchId" AS official_in_punch_id,
             s."officialOutPunchId" AS official_out_punch_id,
             s."officialInTime" AS official_in_time,
             s."officialOutTime" AS official_out_time,
             s."totalWorkedMinutes" AS total_worked_minutes,
             s."lateMinutes" AS late_minutes,
             s."earlyLeaveMinutes" AS early_leave_minutes,
             s."overtimeMinutes" AS overtime_minutes,
             s."lockedAt" AS locked_at,
             pin."sourceType"::text AS in_source,
             pout."sourceType"::text AS out_source
      FROM attendance_daily_summaries s
      LEFT JOIN attendance_raw_punches pin ON pin.id = s."officialInPunchId"
      LEFT JOIN attendance_raw_punches pout ON pout.id = s."officialOutPunchId"
      WHERE s."employeeId" = ANY(${ids}::text[])
        AND s."workDate" >= ${`${period.periodStart} 00:00:00`}::timestamp
        AND s."workDate" <= ${`${period.periodEnd} 00:00:00`}::timestamp`;
    const assignments = await tx.shiftAssignment.findMany({
      where: {
        employeeId: { in: ids },
        effectiveFrom: { lt: period.rangeEndUtc },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.rangeStartUtc } }],
      },
      select: { id: true, employeeId: true, effectiveFrom: true, effectiveTo: true, shift: true },
    });
    // HR-POLICY-01: ACTIVE working-calendar facts for these employees and their shifts (fixed queries).
    const calendar = await loadCalendarContext(tx, ids, [...new Set(assignments.map((a) => a.shift.id))], period.periodStart, period.periodEnd);
    const corrections = await tx.attendanceCorrection.groupBy({
      by: ['employeeId', 'workDate'],
      where: { employeeId: { in: ids }, status: CorrectionStatus.PENDING, workDate: { gte: firstDate, lte: lastDate } },
      _count: { _all: true },
    });
    // Kuwait work date computed in SQL from the timestamp(3) UTC column; bounds passed as
    // timezone-less literals so the session TimeZone can never shift them.
    const toSqlTimestamp = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');
    const punchCounts = await tx.$queryRaw<{ employee_id: string; work_date: string; pending: number; rejected: number; locked_late: number }[]>`
      SELECT "employeeId" AS employee_id,
             to_char("punchTimeSource" + interval '3 hours', 'YYYY-MM-DD') AS work_date,
             count(*) FILTER (WHERE "validationStatus" IN ('PENDING_HR_REVIEW', 'PENDING_MANAGER_APPROVAL'))::int AS pending,
             count(*) FILTER (WHERE "validationStatus"::text LIKE 'REJECTED%')::int AS rejected,
             count(*) FILTER (WHERE "fraudFlags" @> '[{"flag": "LOCKED_PERIOD_LATE_PUNCH"}]'::jsonb)::int AS locked_late
      FROM attendance_raw_punches
      WHERE "employeeId" = ANY(${ids}::text[])
        AND "punchTimeSource" >= ${toSqlTimestamp(period.rangeStartUtc)}::timestamp
        AND "punchTimeSource" < ${toSqlTimestamp(period.rangeEndUtc)}::timestamp
      GROUP BY 1, 2`;

    const byEmployee = <T>(rows: T[], key: (r: T) => string) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const k = key(row);
        map.set(k, [...(map.get(k) ?? []), row]);
      }
      return map;
    };
    const summariesByEmployee = byEmployee(summaries, (s) => s.employee_id);
    const assignmentsByEmployee = byEmployee(assignments, (a) => a.employeeId);
    const correctionsByEmployee = byEmployee(corrections, (c) => c.employeeId);
    const punchesByEmployee = byEmployee(punchCounts, (p) => p.employee_id);

    return employees.map((employee) => {
      const summariesByDate = new Map<string, SummaryFact>(
        (summariesByEmployee.get(employee.id) ?? []).map((s) => [
          s.work_date,
          {
            workDate: s.work_date,
            status: s.status,
            officialInPunchId: s.official_in_punch_id,
            officialOutPunchId: s.official_out_punch_id,
            officialInTime: s.official_in_time,
            officialOutTime: s.official_out_time,
            officialInSourceType: s.in_source,
            officialOutSourceType: s.out_source,
            totalWorkedMinutes: s.total_worked_minutes,
            lateMinutes: s.late_minutes,
            earlyLeaveMinutes: s.early_leave_minutes,
            overtimeMinutes: s.overtime_minutes,
            lockedAt: s.locked_at,
          },
        ]),
      );
      const assignmentFacts: AssignmentFact[] = (assignmentsByEmployee.get(employee.id) ?? []).map((a) => ({
        id: a.id,
        effectiveFrom: a.effectiveFrom,
        effectiveTo: a.effectiveTo,
        shift: {
          id: a.shift.id,
          name: a.shift.name,
          code: a.shift.code,
          startTimeMinutes: a.shift.startTimeMinutes,
          endTimeMinutes: a.shift.endTimeMinutes,
          isOvernight: a.shift.isOvernight,
          gracePeriodMinutes: a.shift.gracePeriodMinutes,
          breakMinutes: a.shift.breakMinutes,
          isActive: a.shift.isActive,
        },
      }));
      const punchCountsByDate = new Map<string, PunchCountsFact>(
        (punchesByEmployee.get(employee.id) ?? []).map((p) => [
          p.work_date,
          { pendingReview: p.pending, rejected: p.rejected, lockedPeriodLate: p.locked_late },
        ]),
      );
      const pendingCorrectionsByDate = new Map<string, number>(
        (correctionsByEmployee.get(employee.id) ?? []).map((c) => [c.workDate.toISOString().slice(0, 10), c._count._all]),
      );
      return calculateEmployeeMonth({
        employee,
        period,
        summariesByDate,
        assignments: assignmentFacts,
        punchCountsByDate,
        pendingCorrectionsByDate,
        lockedDates,
        calendar,
      });
    });
  }
}
