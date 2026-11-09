/**
 * RUST-03 NestJS side of the daily-summary parity check.
 *
 * For every scenario in packages/attendance-test-vectors/summary-v1.scenarios.json this seeds the
 * scenario's facts (employee, shifts, assignments, punches, existing summary, payroll lock) into
 * the guarded test database, then calls the REAL, unmodified
 * AttendanceSummaryCalculatorService.calculateForEmployeeDate. It reads back the stored summary
 * and every punch's isOfficial flag, and converts them to the canonical outcome (database ids →
 * fixture refs). A ConflictException is mapped to the matching REFUSED_* outcome.
 *
 * Record mode (PARITY_RECORD=1) skips the comparison and only writes
 * apps/api/test-output/parity/nest-summary-results.json.
 *
 * DESTRUCTIVE: truncates the guarded recafco_hrms_test between scenarios (needs
 * RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test). Never touches any other database.
 */
import { ConflictException, type INestApplication } from '@nestjs/common';
import { DailyAttendanceStatus, EmploymentType, PayrollLockStatus } from '@recafco/db';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AttendanceSummaryCalculatorService } from '../../src/attendance-summaries/attendance-summary-calculator.service';
import { createTestApp, resetDatabase } from '../support/app';
import { getTestPrismaClient } from '../support/test-prisma';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { compareSummaryOutcome } = require('../../../../packages/attendance-test-vectors/parity-compare.cjs') as {
  compareSummaryOutcome: (e: unknown, a: unknown) => { equal: boolean; differences: unknown[] };
};

const VECTORS_DIR = resolve(__dirname, '../../../../packages/attendance-test-vectors');
const OUTPUT_DIR = resolve(__dirname, '../../test-output/parity');
const RECORD = process.env.PARITY_RECORD === '1';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Scenario {
  id: string;
  title: string;
  input: Record<string, any>;
}

const scenarioDoc = JSON.parse(readFileSync(resolve(VECTORS_DIR, 'summary-v1.scenarios.json'), 'utf8')) as {
  rulesetVersion: string;
  resultContractVersion: string;
  scenarios: Scenario[];
};
const expectedDoc = RECORD
  ? null
  : (JSON.parse(readFileSync(resolve(VECTORS_DIR, 'summary-v1.expected.json'), 'utf8')) as { outcomes: Record<string, unknown> });

const prisma = getTestPrismaClient();
const ctx = { ipAddress: null, userAgent: null };
const results: Record<string, unknown> = {};

async function runScenario(scenario: Scenario, app: INestApplication): Promise<unknown> {
  const { input } = scenario;
  const refOf = new Map<string, string>(); // database id → fixture ref

  const employee = await prisma.employee.create({
    data: {
      employeeCode: input.employeeId,
      firstName: 'Fixture',
      lastName: input.employeeId,
      employmentType: EmploymentType.FULL_TIME,
      hireDate: new Date('2024-01-01T00:00:00Z'),
    },
  });
  const actor = await prisma.user.create({ data: { username: 'parity-actor', passwordHash: 'x' } });

  const shiftIds = new Map<string, string>();
  for (const assignment of input.shiftAssignments ?? []) {
    const s = assignment.shift;
    if (!shiftIds.has(s.id)) {
      const row = await prisma.shift.create({
        data: {
          name: s.id,
          code: s.id,
          startTimeMinutes: s.startTimeMinutes,
          endTimeMinutes: s.endTimeMinutes,
          isOvernight: s.isOvernight,
          gracePeriodMinutes: s.gracePeriodMinutes ?? 0,
          breakMinutes: s.breakMinutes ?? 0,
          isActive: s.isActive ?? true,
        },
      });
      shiftIds.set(s.id, row.id);
    }
    await prisma.shiftAssignment.create({
      data: {
        employeeId: employee.id,
        shiftId: shiftIds.get(s.id) as string,
        effectiveFrom: new Date(assignment.effectiveFrom),
        effectiveTo: assignment.effectiveTo ? new Date(assignment.effectiveTo) : null,
      },
    });
  }

  for (const punch of input.punches ?? []) {
    const row = await prisma.attendanceRawPunch.create({
      data: {
        employeeId: employee.id,
        punchType: punch.punchType,
        sourceType: punch.sourceType,
        punchTimeSource: new Date(punch.punchTimeSource),
        punchTimeServer: new Date(punch.punchTimeSource),
        validationStatus: punch.validationStatus,
        isOfficial: punch.isOfficial ?? false,
      },
    });
    refOf.set(row.id, punch.id);
  }

  const workDate = new Date(`${input.workDate}T00:00:00Z`);
  if (input.existingSummary) {
    await prisma.attendanceDailySummary.create({
      data: {
        employeeId: employee.id,
        workDate,
        status: DailyAttendanceStatus.ABSENT,
        calculationVersion: input.existingSummary.calculationVersion,
        calculatedAt: new Date('2026-11-01T00:00:00Z'),
        lockedAt: input.existingSummary.locked ? new Date('2026-11-02T00:00:00Z') : null,
      },
    });
  }
  if (input.periodLocked) {
    await prisma.attendancePayrollLock.create({
      data: { periodStart: workDate, periodEnd: workDate, status: PayrollLockStatus.LOCKED, lockedAt: new Date() },
    });
  }

  const officialPunchIds = async () =>
    (await prisma.attendanceRawPunch.findMany({ where: { employeeId: employee.id, isOfficial: true }, select: { id: true } }))
      .map((p) => refOf.get(p.id) as string)
      .sort();

  try {
    const summary = await app
      .get(AttendanceSummaryCalculatorService)
      .calculateForEmployeeDate(employee.id, input.workDate, actor.id, ctx);
    const sourceOf = async (id: string | null) =>
      id ? (await prisma.attendanceRawPunch.findUniqueOrThrow({ where: { id } })).sourceType : null;
    return {
      outcome: 'CALCULATED',
      officialInPunchId: summary.officialInPunchId ? refOf.get(summary.officialInPunchId) : null,
      officialOutPunchId: summary.officialOutPunchId ? refOf.get(summary.officialOutPunchId) : null,
      officialInTime: summary.officialInTime?.toISOString() ?? null,
      officialOutTime: summary.officialOutTime?.toISOString() ?? null,
      officialInSourceType: await sourceOf(summary.officialInPunchId),
      officialOutSourceType: await sourceOf(summary.officialOutPunchId),
      totalWorkedMinutes: summary.totalWorkedMinutes,
      lateMinutes: summary.lateMinutes,
      earlyLeaveMinutes: summary.earlyLeaveMinutes,
      overtimeMinutes: summary.overtimeMinutes,
      status: summary.status,
      calculationVersion: summary.calculationVersion,
      officialPunchIds: await officialPunchIds(),
    };
  } catch (error) {
    if (!(error instanceof ConflictException)) throw error;
    const outcome = /locked payroll period/i.test(error.message)
      ? 'REFUSED_LOCKED_PERIOD'
      : /locked attendance summary/i.test(error.message)
        ? 'REFUSED_LOCKED_SUMMARY'
        : `UNEXPECTED_CONFLICT: ${error.message}`;
    return {
      outcome,
      officialInPunchId: null,
      officialOutPunchId: null,
      officialInTime: null,
      officialOutTime: null,
      officialInSourceType: null,
      officialOutSourceType: null,
      totalWorkedMinutes: null,
      lateMinutes: null,
      earlyLeaveMinutes: null,
      overtimeMinutes: null,
      status: null,
      calculationVersion: null,
      officialPunchIds: await officialPunchIds(),
    };
  }
}

describe(`RUST-03 daily-summary parity — NestJS side (${scenarioDoc.rulesetVersion})`, () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(
      resolve(OUTPUT_DIR, 'nest-summary-results.json'),
      `${JSON.stringify({ producer: 'nestjs', rulesetVersion: scenarioDoc.rulesetVersion, resultContractVersion: scenarioDoc.resultContractVersion, outcomes: results }, null, 2)}\n`,
    );
    await app.close();
  });

  it.each(scenarioDoc.scenarios.map((s) => [s.id, s] as const))('%s', async (_id, scenario) => {
    await resetDatabase();
    const outcome = await runScenario(scenario, app);
    results[scenario.id] = outcome;
    if (!RECORD) {
      const expected = expectedDoc?.outcomes[scenario.id];
      expect(expected).toBeDefined();
      expect(compareSummaryOutcome(expected, outcome).differences).toEqual([]);
    }
  });
});
