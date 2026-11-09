/**
 * Unit 21.1 — payroll-closing readiness + backend lock enforcement.
 * DESTRUCTIVE only to the guarded recafco_hrms_test (truncated per test; requires
 * RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test). Synthetic data, future dates only.
 *
 * Default period under test: 2031-03-01 .. 2031-03-07 (7 days). Times are Asia/Kuwait local.
 * Concurrency cases are deterministic: the test holds the same row lock a real competing
 * operation holds, proves the other side is blocked, then releases it.
 */
import type { INestApplication } from '@nestjs/common';
import {
  AttendanceSourceType,
  CorrectionStatus,
  CorrectionType,
  DailyAttendanceStatus,
  EmploymentType,
  PayrollLockStatus,
  PunchType,
  PunchValidationStatus,
} from '@recafco/db';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { AttendanceCorrectionsService } from '../../src/attendance-corrections/attendance-corrections.service';
import { AttendanceSummaryCalculatorService } from '../../src/attendance-summaries/attendance-summary-calculator.service';
import { ROLE_PERMISSIONS } from '../../src/auth/constants/rbac.constants';
import { READINESS_SAMPLE_LIMIT } from '../../src/payroll-locks/payroll-closing-readiness.rules';
import { PayrollLocksService } from '../../src/payroll-locks/payroll-locks.service';
import { accessTokenFor, createTestApp, resetDatabase } from '../support/app';
import { createAdminUser } from '../support/fixtures';
import { getTestPrismaClient } from '../support/test-prisma';

const prisma = getTestPrismaClient();
const START = '2031-03-01';
const END = '2031-03-07';
const WEEK = ['2031-03-01', '2031-03-02', '2031-03-03', '2031-03-04', '2031-03-05', '2031-03-06', '2031-03-07'];
const ctx = { ipAddress: null, userAgent: null };

/** Kuwait local date + HH:MM → UTC instant. */
const k = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00.000Z`) - 3 * 3600_000);
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

let seq = 0;
const uniq = (p: string) => `${p}${(seq += 1).toString().padStart(4, '0')}`;

async function employee(opts: { hire?: string; termination?: string } = {}) {
  return prisma.employee.create({
    data: {
      employeeCode: uniq('R'),
      firstName: 'Synthetic',
      lastName: uniq('Person'),
      employmentType: EmploymentType.FULL_TIME,
      hireDate: day(opts.hire ?? '2030-01-01'),
      terminationDate: opts.termination ? day(opts.termination) : null,
    },
  });
}

async function shift(o: { start?: number; end?: number; overnight?: boolean; grace?: number; brk?: number; active?: boolean } = {}) {
  return prisma.shift.create({
    data: {
      name: uniq('Shift'),
      startTimeMinutes: o.start ?? 420,
      endTimeMinutes: o.end ?? 960,
      isOvernight: o.overnight ?? false,
      gracePeriodMinutes: o.grace ?? 0,
      breakMinutes: o.brk ?? 0,
      isActive: o.active ?? true,
    },
  });
}

const assign = (employeeId: string, shiftId: string, from = '2030-01-01') =>
  prisma.shiftAssignment.create({ data: { employeeId, shiftId, effectiveFrom: day(from) } });

async function rawPunch(
  employeeId: string,
  date: string,
  time: string,
  o: { type?: PunchType; source?: AttendanceSourceType; status?: PunchValidationStatus; validatedAt?: Date | null } = {},
) {
  const at = k(date, time);
  return prisma.attendanceRawPunch.create({
    data: {
      employeeId,
      punchType: o.type ?? PunchType.IN,
      sourceType: o.source ?? AttendanceSourceType.MOBILE,
      punchTimeSource: at,
      punchTimeServer: at,
      validationStatus: o.status ?? PunchValidationStatus.ACCEPTED,
      validatedAt: o.validatedAt === undefined ? null : o.validatedAt,
    },
  });
}

/** Accepted IN/OUT punches, then the stored summary (calculatedAt AFTER the punches, as the calculator does). */
async function seedDay(
  employeeId: string,
  date: string,
  o: { in?: string | null; out?: string | null; status?: DailyAttendanceStatus; late?: number; inSource?: AttendanceSourceType; outSource?: AttendanceSourceType } = {},
) {
  const inTime = o.in === undefined ? '07:00' : o.in;
  const outTime = o.out === undefined ? '16:00' : o.out;
  const pin = inTime ? await rawPunch(employeeId, date, inTime, { type: PunchType.IN, source: o.inSource ?? AttendanceSourceType.MOBILE }) : null;
  const pout = outTime ? await rawPunch(employeeId, date, outTime, { type: PunchType.OUT, source: o.outSource ?? AttendanceSourceType.BIOMETRIC_DEVICE }) : null;
  return prisma.attendanceDailySummary.create({
    data: {
      employeeId,
      workDate: day(date),
      officialInPunchId: pin?.id ?? null,
      officialOutPunchId: pout?.id ?? null,
      officialInTime: pin?.punchTimeSource ?? null,
      officialOutTime: pout?.punchTimeSource ?? null,
      totalWorkedMinutes: pin && pout ? Math.round((pout.punchTimeSource.getTime() - pin.punchTimeSource.getTime()) / 60_000) : 0,
      lateMinutes: o.late ?? 0,
      status: o.status ?? (pin && pout ? DailyAttendanceStatus.PRESENT : pin || pout ? DailyAttendanceStatus.MISSING_PUNCH : DailyAttendanceStatus.ABSENT),
      // Shift/assignment staleness compares updatedAt with calculatedAt; keep the seeded
      // calculation clearly after setup regardless of clock granularity (see 25c).
      calculatedAt: new Date(Date.now() + 100),
    },
  });
}

/** Employee with a valid day shift and every listed date cleanly PRESENT. */
async function cleanEmployee(dates: string[] = WEEK, opts: { hire?: string; termination?: string } = {}) {
  const e = await employee(opts);
  const s = await shift();
  await assign(e.id, s.id);
  for (const d of dates) await seedDay(e.id, d);
  return { employee: e, shift: s };
}

const openPeriod = (start = START, end = END) =>
  prisma.attendancePayrollLock.create({ data: { periodStart: day(start), periodEnd: day(end), status: PayrollLockStatus.OPEN } });

async function pendingCorrection(employeeId: string, date: string, requestedBy: string, o: { type?: CorrectionType; time?: string } = {}) {
  const type = o.type ?? CorrectionType.MISSED_OUT;
  return prisma.attendanceCorrection.create({
    data: {
      employeeId,
      workDate: day(date),
      requestedByUserId: requestedBy,
      reason: 'Synthetic test correction',
      status: CorrectionStatus.PENDING,
      correctionType: type,
      requestedPunchType: type === CorrectionType.MISSED_OUT ? PunchType.OUT : PunchType.IN,
      requestedPunchTime: k(date, o.time ?? '16:00'),
      beforeSnapshot: {},
      afterSnapshot: {},
    },
  });
}

describe('Unit 21.1 — payroll closing readiness and lock enforcement', () => {
  let app: INestApplication;
  let actorId: string;
  const http = () => request(app.getHttpServer());
  const auth = (role: keyof typeof ROLE_PERMISSIONS) => `Bearer ${accessTokenFor(app, actorId, ROLE_PERMISSIONS[role])}`;
  const readiness = async (id: string, role: keyof typeof ROLE_PERMISSIONS = 'PAYROLL_OFFICER') =>
    (await http().get(`/payroll-locks/${id}/readiness`).set('Authorization', auth(role)).expect(200)).body;
  const lock = (id: string, role: keyof typeof ROLE_PERMISSIONS = 'PAYROLL_OFFICER') =>
    http().post(`/payroll-locks/${id}/lock`).set('Authorization', auth(role));
  /** Asserts readiness is NOT ready and that `code` is a blocking issue on the given dates. */
  const expectBlocked = async (id: string, code: string, employeeDays: number) => {
    const r = await readiness(id);
    expect(r.ready).toBe(false);
    expect(r.issuesByType[code]).toEqual(expect.objectContaining({ severity: 'BLOCKING', employeeDays }));
    return r;
  };

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase();
    actorId = await createAdminUser();
  });
  afterAll(async () => {
    await app.close();
  });

  it('clock sanity: punch createdAt (DB/Prisma) is UTC (not Kuwait-local), within ±1 s of the API clock', async () => {
    const e = await employee();
    const before = Date.now();
    const p = await rawPunch(e.id, START, '07:00');
    const after = Date.now();
    expect(p.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(p.createdAt.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  // 1
  it('complete valid period is READY (not payroll approval)', async () => {
    await cleanEmployee();
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r).toMatchObject({
      ready: true,
      periodStart: START,
      periodEnd: END,
      calendarDays: 7,
      employeesEvaluated: 1,
      employeeDaysEvaluated: 7,
      scheduledWorkingDaysKnown: false,
      blockingIssueCount: 0,
      warningCount: 0,
      sampleIssues: [],
      rulesVersion: 'payroll-closing-readiness/2',
    });
    expect(Date.parse(r.evaluatedAt)).not.toBeNaN();
  });

  // 2
  it('punches without a daily summary → MISSING_DAILY_SUMMARY', async () => {
    const { employee: e } = await cleanEmployee(WEEK.filter((d) => d !== '2031-03-03'));
    await rawPunch(e.id, '2031-03-03', '07:05');
    const period = await openPeriod();
    const r = await expectBlocked(period.id, 'MISSING_DAILY_SUMMARY', 1);
    expect(r.issuesByType.WORK_CALENDAR_NOT_CONFIGURED).toBeUndefined();
  });

  // 3, 4
  it('MISSING_PUNCH summaries are split into MISSING_IN / MISSING_OUT', async () => {
    const e = await employee();
    const s = await shift();
    await assign(e.id, s.id);
    for (const d of WEEK.slice(2)) await seedDay(e.id, d);
    await seedDay(e.id, '2031-03-01', { in: null });
    await seedDay(e.id, '2031-03-02', { out: null });
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r.ready).toBe(false);
    expect(r.issuesByType).toEqual({
      MISSING_IN: { severity: 'BLOCKING', employeeDays: 1, employees: 1 },
      MISSING_OUT: { severity: 'BLOCKING', employeeDays: 1, employees: 1 },
    });
    expect(r.blockingIssueCount).toBe(2);
  });

  // 5
  it('pending correction blocks; once rejected the period is ready', async () => {
    const { employee: e } = await cleanEmployee();
    const c = await pendingCorrection(e.id, '2031-03-04', actorId);
    const period = await openPeriod();
    await expectBlocked(period.id, 'PENDING_CORRECTION', 1);
    await prisma.attendanceCorrection.update({ where: { id: c.id }, data: { status: CorrectionStatus.REJECTED } });
    expect((await readiness(period.id)).ready).toBe(true);
  });

  // 6
  it('punch awaiting HR or manager review → PENDING_REVIEW_PUNCHES', async () => {
    const { employee: e } = await cleanEmployee();
    await rawPunch(e.id, '2031-03-02', '12:00', { status: PunchValidationStatus.PENDING_HR_REVIEW });
    await rawPunch(e.id, '2031-03-05', '12:00', { status: PunchValidationStatus.PENDING_MANAGER_APPROVAL, source: AttendanceSourceType.MANUAL_CORRECTION });
    const period = await openPeriod();
    const r = await expectBlocked(period.id, 'PENDING_REVIEW_PUNCHES', 2);
    expect(r.issuesByType.UNRESOLVED_DEVICE_IMPORT).toBeUndefined();
  });

  // 7
  it('unresolved (pending) biometric / import events → UNRESOLVED_DEVICE_IMPORT', async () => {
    const { employee: e } = await cleanEmployee();
    await rawPunch(e.id, '2031-03-02', '12:00', { status: PunchValidationStatus.PENDING_HR_REVIEW, source: AttendanceSourceType.BIOMETRIC_DEVICE });
    await rawPunch(e.id, '2031-03-03', '12:00', { status: PunchValidationStatus.PENDING_HR_REVIEW, source: AttendanceSourceType.IMPORT });
    const period = await openPeriod();
    const r = await expectBlocked(period.id, 'UNRESOLVED_DEVICE_IMPORT', 2);
    expect(r.issuesByType.PENDING_REVIEW_PUNCHES).toBeUndefined();
  });

  // 8
  it('OUT before IN → OUT_BEFORE_IN', async () => {
    const e = await employee();
    const s = await shift();
    await assign(e.id, s.id);
    for (const d of WEEK.slice(1)) await seedDay(e.id, d);
    await seedDay(e.id, '2031-03-01', { in: '16:00', out: '07:00' });
    const period = await openPeriod();
    await expectBlocked(period.id, 'OUT_BEFORE_IN', 1);
  });

  // 9
  it('no shift assignment → NO_SHIFT_ASSIGNMENT', async () => {
    const e = await employee();
    for (const d of WEEK) await seedDay(e.id, d);
    const period = await openPeriod();
    await expectBlocked(period.id, 'NO_SHIFT_ASSIGNMENT', 7);
  });

  // 10, 12, 13, 14
  it.each([
    ['invalid shift (start = end)', { start: 600, end: 600 }, 'SHIFT_CONFIGURATION_INVALID'],
    ['inactive shift', { active: false }, 'SHIFT_INACTIVE'],
    ['overnight shift', { start: 1260, end: 300, overnight: true }, 'OVERNIGHT_SHIFT_CALENDAR_SPLIT'],
    ['break configured but not applied', { brk: 60 }, 'BREAK_NOT_APPLIED'],
  ] as const)('%s → %s', async (_label, shiftOpts, code) => {
    const e = await employee();
    const s = await shift(shiftOpts);
    await assign(e.id, s.id);
    for (const d of WEEK) await seedDay(e.id, d);
    const period = await openPeriod();
    await expectBlocked(period.id, code, 7);
  });

  // 11
  it('overlapping shift assignments (same effective date) → SHIFT_ASSIGNMENT_AMBIGUOUS', async () => {
    const { employee: e } = await cleanEmployee();
    const other = await shift({ start: 480, end: 1020 });
    await prisma.shiftAssignment.create({ data: { employeeId: e.id, shiftId: other.id, effectiveFrom: day('2030-01-01') } });
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r.ready).toBe(false);
    expect(r.issuesByType.SHIFT_ASSIGNMENT_AMBIGUOUS).toEqual(expect.objectContaining({ employeeDays: 7 }));
  });

  // 15
  it('grace configured with late minutes → GRACE_NOT_APPLIED (only on late days)', async () => {
    const e = await employee();
    const s = await shift({ grace: 10 });
    await assign(e.id, s.id);
    for (const d of WEEK.slice(1)) await seedDay(e.id, d);
    await seedDay(e.id, '2031-03-01', { in: '07:05', late: 5, status: DailyAttendanceStatus.LATE });
    const period = await openPeriod();
    await expectBlocked(period.id, 'GRACE_NOT_APPLIED', 1);
  });

  // 16, 26
  it('days with no summary and no punches fail closed → WORK_CALENDAR_NOT_CONFIGURED (never assumed absent or rest day)', async () => {
    const { employee: partial } = await cleanEmployee(WEEK.filter((d) => d !== '2031-03-06'));
    const nobody = await employee();
    await assign(nobody.id, (await shift()).id);
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r.ready).toBe(false);
    expect(r.issuesByType.WORK_CALENDAR_NOT_CONFIGURED).toEqual({ severity: 'BLOCKING', employeeDays: 8, employees: 2 });
    expect(r.issuesByType.ABSENT_NOT_HR_CONFIRMED).toBeUndefined();
    expect(r.sampleIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ employeeId: partial.id, workDate: '2031-03-06', codes: ['WORK_CALENDAR_NOT_CONFIGURED'] })]),
    );
  });

  // 17
  it('uses EXACT period boundaries (partial month), including Kuwait-time punch boundaries', async () => {
    const e = await employee();
    const s = await shift();
    await assign(e.id, s.id);
    // Problems just outside the period must be ignored.
    await seedDay(e.id, '2031-03-02', { out: null });
    await seedDay(e.id, '2031-03-06', { in: null });
    for (const d of ['2031-03-03', '2031-03-04', '2031-03-05']) await seedDay(e.id, d);
    // 2031-03-06 00:10 Kuwait = 2031-03-05 21:10 UTC: belongs to 03-06 (outside), not 03-05.
    await rawPunch(e.id, '2031-03-06', '00:10', { status: PunchValidationStatus.PENDING_HR_REVIEW });
    const period = await openPeriod('2031-03-03', '2031-03-05');
    const r = await readiness(period.id);
    expect(r).toMatchObject({ ready: true, periodStart: '2031-03-03', periodEnd: '2031-03-05', calendarDays: 3, employeeDaysEvaluated: 3 });

    // 2031-03-05 23:30 Kuwait is inside the period.
    await rawPunch(e.id, '2031-03-05', '23:30', { status: PunchValidationStatus.PENDING_HR_REVIEW });
    await expectBlocked(period.id, 'PENDING_REVIEW_PUNCHES', 1);
  });

  // 18
  it('a READY period locks; summaries are frozen and the audit records the readiness facts', async () => {
    await cleanEmployee();
    const period = await openPeriod();
    const res = await lock(period.id).expect(201);
    expect(res.body).toMatchObject({ lock: { status: 'LOCKED', summaryCount: 7 }, affectedSummaryCount: 7 });
    expect(await prisma.attendanceDailySummary.count({ where: { lockedAt: null } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: period.id, action: 'PAYROLL_PERIOD_LOCKED' } });
    expect(audit.afterSnapshot).toMatchObject({ readiness: { ready: true, blockingIssueCount: 0, employeesEvaluated: 1 } });
  });

  // 19
  it('a NOT-READY period returns 409 with reason codes; nothing is locked; the refusal is audited', async () => {
    const { employee: e } = await cleanEmployee();
    await pendingCorrection(e.id, '2031-03-02', actorId);
    const period = await openPeriod();
    const res = await lock(period.id).expect(409);
    expect(res.body).toMatchObject({
      code: 'PAYROLL_PERIOD_NOT_READY',
      reasonCodes: ['PENDING_CORRECTION'],
      readiness: { ready: false, blockingIssueCount: 1 },
    });
    expect(res.body.message).toMatch(/cannot be locked/);
    expect((await prisma.attendancePayrollLock.findUniqueOrThrow({ where: { id: period.id } })).status).toBe('OPEN');
    expect(await prisma.attendanceDailySummary.count({ where: { lockedAt: { not: null } } })).toBe(0);
    const refusal = await prisma.auditLog.findFirstOrThrow({ where: { entityId: period.id, action: 'PAYROLL_PERIOD_LOCK_REFUSED_NOT_READY' } });
    expect(refusal.afterSnapshot).toMatchObject({ ready: false, issuesByType: { PENDING_CORRECTION: { employeeDays: 1 } } });
  });

  // 20, 21
  it.each(['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'] as const)('%s cannot bypass blockers (no force/override parameter exists)', async (role) => {
    await cleanEmployee(WEEK.slice(0, 6));
    const period = await openPeriod();
    await lock(period.id, role).query({ force: 'true', override: 'true' }).send({ force: true, override: true, bypass: true }).expect(409);
    expect((await prisma.attendancePayrollLock.findUniqueOrThrow({ where: { id: period.id } })).status).toBe('OPEN');
  });

  // 22
  it('a LOCKED period cannot be locked again', async () => {
    await cleanEmployee();
    const period = await openPeriod();
    await lock(period.id).expect(201);
    const res = await lock(period.id).expect(409);
    expect(res.body.message).toMatch(/Only an open or reopened/);
  });

  // 23a
  it('RACE: lock waits for an in-flight recalculation and evaluates its RESULT (recalc makes the day unresolved → 409)', async () => {
    const { employee: e } = await cleanEmployee();
    const period = await openPeriod();
    const locks = app.get(PayrollLocksService);
    let outcome: 'pending' | 'locked' | 'refused' = 'pending';
    await prisma.$transaction(async (tx) => {
      // What an in-flight recalculation holds: FOR SHARE on the covering period row.
      await tx.$queryRawUnsafe('SELECT id FROM attendance_payroll_locks WHERE id = $1 FOR SHARE', period.id);
      void locks.lockPeriod(period.id, actorId, ctx).then(
        () => (outcome = 'locked'),
        () => (outcome = 'refused'),
      );
      await sleep(400);
      expect(outcome).toBe('pending');
      // The recalculation's result: the OUT punch disappears from the official selection.
      await tx.attendanceDailySummary.update({
        where: { employeeId_workDate: { employeeId: e.id, workDate: day('2031-03-04') } },
        data: { officialOutPunchId: null, officialOutTime: null, status: DailyAttendanceStatus.MISSING_PUNCH, calculatedAt: new Date() },
      });
    });
    for (let i = 0; i < 100 && outcome === 'pending'; i += 1) await sleep(50);
    expect(outcome).toBe('refused');
    expect((await prisma.attendancePayrollLock.findUniqueOrThrow({ where: { id: period.id } })).status).toBe('OPEN');
  });

  // 23b
  it('RACE: an in-flight recalculation that RESOLVES the last issue lets the waiting lock succeed', async () => {
    const e = await employee();
    const s = await shift();
    await assign(e.id, s.id);
    for (const d of WEEK.slice(1)) await seedDay(e.id, d);
    const broken = await seedDay(e.id, '2031-03-01', { out: null });
    const out = await rawPunch(e.id, '2031-03-01', '16:00', { type: PunchType.OUT, source: AttendanceSourceType.BIOMETRIC_DEVICE });
    const period = await openPeriod();
    const locks = app.get(PayrollLocksService);
    let outcome: 'pending' | 'locked' | 'refused' = 'pending';
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM attendance_payroll_locks WHERE id = $1 FOR SHARE', period.id);
      void locks.lockPeriod(period.id, actorId, ctx).then(
        () => (outcome = 'locked'),
        () => (outcome = 'refused'),
      );
      await sleep(400);
      expect(outcome).toBe('pending');
      await tx.attendanceDailySummary.update({
        where: { id: broken.id },
        data: { officialOutPunchId: out.id, officialOutTime: out.punchTimeSource, status: DailyAttendanceStatus.PRESENT, totalWorkedMinutes: 540, calculatedAt: new Date() },
      });
    });
    for (let i = 0; i < 100 && outcome === 'pending'; i += 1) await sleep(50);
    expect(outcome).toBe('locked');
  });

  // 23c
  it('after a lock commits, a new recalculation for a locked date refuses (summary untouched)', async () => {
    const { employee: e } = await cleanEmployee();
    const period = await openPeriod();
    await lock(period.id).expect(201);
    const calc = app.get(AttendanceSummaryCalculatorService);
    await expect(calc.calculateForEmployeeDate(e.id, '2031-03-03', actorId, ctx)).rejects.toThrow(/locked/);
  });

  // 24a
  it('RACE: correction approval racing a lock waits on the period row and refuses once LOCKED (fix: check inside the transaction)', async () => {
    const e = await employee();
    const s = await shift();
    await assign(e.id, s.id);
    for (const d of WEEK) await seedDay(e.id, d);
    const c = await pendingCorrection(e.id, '2031-03-02', actorId);
    const period = await openPeriod();
    const corrections = app.get(AttendanceCorrectionsService);
    let outcome: 'pending' | 'approved' | 'refused' = 'pending';
    await prisma.$transaction(async (tx) => {
      // Exactly what lockPeriod holds while it decides: FOR UPDATE on the period row.
      await tx.$queryRawUnsafe('SELECT id FROM attendance_payroll_locks WHERE id = $1 FOR UPDATE', period.id);
      void corrections.approveCorrection(c.id, actorId, ctx).then(
        () => (outcome = 'approved'),
        () => (outcome = 'refused'),
      );
      await sleep(400);
      expect(outcome).toBe('pending');
      await tx.attendancePayrollLock.update({ where: { id: period.id }, data: { status: PayrollLockStatus.LOCKED, lockedAt: new Date() } });
    });
    for (let i = 0; i < 100 && outcome === 'pending'; i += 1) await sleep(50);
    expect(outcome).toBe('refused');
    expect((await prisma.attendanceCorrection.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('PENDING');
    expect(await prisma.attendanceRawPunch.count({ where: { sourceType: AttendanceSourceType.MANUAL_CORRECTION } })).toBe(0);
  });

  // 24b
  it('RACE window: correction approved but day not yet recalculated → DAILY_SUMMARY_STALE blocks the lock', async () => {
    const e = await employee();
    const s = await shift();
    await assign(e.id, s.id);
    for (const d of WEEK.slice(1)) await seedDay(e.id, d);
    await seedDay(e.id, '2031-03-01', { out: '15:00' });
    // The approval transaction's effect, before its follow-up recalculation ran.
    await rawPunch(e.id, '2031-03-01', '16:00', { type: PunchType.OUT, source: AttendanceSourceType.MANUAL_CORRECTION, status: PunchValidationStatus.ACCEPTED_WITH_WARNING });
    const period = await openPeriod();
    await expectBlocked(period.id, 'DAILY_SUMMARY_STALE', 1);
    await lock(period.id).expect(409);
  });

  // 24c
  it('correction approved end-to-end (approval + recalculation) makes the period ready and lockable', async () => {
    const e = await employee();
    const s = await shift();
    await assign(e.id, s.id);
    for (const d of WEEK.slice(1)) await seedDay(e.id, d);
    await seedDay(e.id, '2031-03-01', { out: null });
    const c = await pendingCorrection(e.id, '2031-03-01', actorId, { type: CorrectionType.MISSED_OUT, time: '16:00' });
    const period = await openPeriod();
    await lock(period.id).expect(409);
    await app.get(AttendanceCorrectionsService).approveCorrection(c.id, actorId, ctx);
    expect((await readiness(period.id)).ready).toBe(true);
    await lock(period.id).expect(201);
  });

  // 25a
  it('RACE window: a punch accepted after the summary was calculated → DAILY_SUMMARY_STALE', async () => {
    const { employee: e } = await cleanEmployee();
    await rawPunch(e.id, '2031-03-05', '06:55', { status: PunchValidationStatus.ACCEPTED, validatedAt: new Date() });
    const period = await openPeriod();
    await expectBlocked(period.id, 'DAILY_SUMMARY_STALE', 1);
  });

  // 25b
  it('an official punch that is no longer eligible (re-validated as rejected) → DAILY_SUMMARY_STALE', async () => {
    const { employee: e } = await cleanEmployee();
    const summary = await prisma.attendanceDailySummary.findFirstOrThrow({ where: { employeeId: e.id, workDate: day('2031-03-02') } });
    await prisma.attendanceRawPunch.update({
      where: { id: summary.officialInPunchId as string },
      data: { validationStatus: PunchValidationStatus.REJECTED_DUPLICATE },
    });
    const period = await openPeriod();
    const r = await expectBlocked(period.id, 'DAILY_SUMMARY_STALE', 1);
    expect(r.issuesByType.REJECTED_PUNCHES).toEqual(expect.objectContaining({ severity: 'WARNING' }));
  });

  // 25c
  it('a covering shift changed after the summary was calculated → DAILY_SUMMARY_STALE on every affected day', async () => {
    const { shift: s } = await cleanEmployee();
    await sleep(300);
    await prisma.shift.update({ where: { id: s.id }, data: { startTimeMinutes: 450 } });
    const period = await openPeriod();
    await expectBlocked(period.id, 'DAILY_SUMMARY_STALE', 7);
  });

  // 27
  it('multiple employees with different issues: per-type employee counts, no double counting, bounded samples', async () => {
    const { employee: a } = await cleanEmployee();
    await pendingCorrection(a.id, '2031-03-03', actorId);
    await rawPunch(a.id, '2031-03-03', '12:00', { status: PunchValidationStatus.PENDING_HR_REVIEW });
    const b = await employee();
    const s = await shift();
    await assign(b.id, s.id);
    for (const d of WEEK.slice(1)) await seedDay(b.id, d);
    await seedDay(b.id, '2031-03-01', { out: null });
    await cleanEmployee(); // clean third employee
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r).toMatchObject({
      ready: false,
      employeesEvaluated: 3,
      employeeDaysEvaluated: 21,
      blockingIssueCount: 3, // PENDING_CORRECTION + PENDING_REVIEW_PUNCHES (a/03-03) + MISSING_OUT (b/03-01)
      affectedEmployees: 2,
      affectedEmployeeDays: 2,
    });
    expect(r.issuesByType).toEqual({
      PENDING_CORRECTION: { severity: 'BLOCKING', employeeDays: 1, employees: 1 },
      PENDING_REVIEW_PUNCHES: { severity: 'BLOCKING', employeeDays: 1, employees: 1 },
      MISSING_OUT: { severity: 'BLOCKING', employeeDays: 1, employees: 1 },
    });
    expect(r.sampleIssues).toHaveLength(2);
    expect(r.sampleIssues).toEqual(
      expect.arrayContaining([
        { employeeId: a.id, employeeCode: a.employeeCode, employeeName: `${a.firstName} ${a.lastName}`, workDate: '2031-03-03', codes: ['PENDING_CORRECTION', 'PENDING_REVIEW_PUNCHES'] },
      ]),
    );
    // Only identifying fields — no contact details, civil ID, etc.
    expect(Object.keys(r.sampleIssues[0]).sort()).toEqual(['codes', 'employeeCode', 'employeeId', 'employeeName', 'workDate']);
  });

  // 28, 29
  it('employee hired mid-period and employee terminated mid-period: only employment days are evaluated', async () => {
    await cleanEmployee(['2031-03-04', '2031-03-05', '2031-03-06', '2031-03-07'], { hire: '2031-03-04' });
    await cleanEmployee(['2031-03-01', '2031-03-02', '2031-03-03'], { termination: '2031-03-03' });
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r).toMatchObject({ ready: true, employeesEvaluated: 2, employeeDaysEvaluated: 7 });
    await lock(period.id).expect(201);
  });

  // 30
  it('unauthenticated → 401; employee-level roles → 403; read-only roles can read readiness but not lock', async () => {
    await cleanEmployee();
    const period = await openPeriod();
    await http().get(`/payroll-locks/${period.id}/readiness`).expect(401);
    await http().post(`/payroll-locks/${period.id}/lock`).expect(401);
    for (const role of ['EMPLOYEE', 'SUPERVISOR', 'DEPARTMENT_MANAGER'] as const) {
      await http().get(`/payroll-locks/${period.id}/readiness`).set('Authorization', auth(role)).expect(403);
      await lock(period.id, role).expect(403);
    }
    for (const role of ['AUDITOR', 'MANAGEMENT_VIEWER'] as const) {
      expect((await readiness(period.id, role)).ready).toBe(true);
      await lock(period.id, role).expect(403);
    }
    await http().get('/payroll-locks/not-a-cuid/readiness').set('Authorization', auth('PAYROLL_OFFICER')).expect(400);
    await http().get('/payroll-locks/cl000000000000000000000000/readiness').set('Authorization', auth('PAYROLL_OFFICER')).expect(404);
  });

  // Extras
  it('a period with no employees fails closed → NO_EMPLOYEES_IN_PERIOD', async () => {
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r).toMatchObject({ ready: false, employeesEvaluated: 0, periodIssues: ['NO_EMPLOYEES_IN_PERIOD'], blockingIssueCount: 1 });
    await lock(period.id).expect(409);
  });

  it('a period longer than 92 days fails closed → PERIOD_TOO_LONG (bounded evaluation)', async () => {
    await cleanEmployee();
    const period = await openPeriod('2031-01-01', '2031-04-30');
    const r = await readiness(period.id);
    expect(r).toMatchObject({ ready: false, periodIssues: ['PERIOD_TOO_LONG'], employeesEvaluated: 0 });
  });

  it('warnings alone (rejected attempts) do not block; counts stay complete while samples are bounded', async () => {
    const { employee: e } = await cleanEmployee();
    await rawPunch(e.id, '2031-03-02', '12:00', { status: PunchValidationStatus.REJECTED_OUTSIDE_LOCATION });
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r).toMatchObject({ ready: true, blockingIssueCount: 0, warningCount: 1 });

    // 9 employees × 7 unknown days = 63 issue days > sample limit.
    for (let i = 0; i < 9; i += 1) {
      const x = await employee();
      await assign(x.id, (await shift()).id);
    }
    const big = await readiness(period.id);
    expect(big.issuesByType.WORK_CALENDAR_NOT_CONFIGURED.employeeDays).toBe(63);
    expect(big.sampleIssues).toHaveLength(READINESS_SAMPLE_LIMIT);
    expect(big.sampleTruncated).toBe(true);
  });

  it('readiness is read-only: evaluating it writes nothing', async () => {
    const { employee: e } = await cleanEmployee();
    await pendingCorrection(e.id, '2031-03-02', actorId);
    const period = await openPeriod();
    const counts = async () =>
      Promise.all([prisma.auditLog.count(), prisma.attendanceDailySummary.count({ where: { lockedAt: { not: null } } }), prisma.attendancePayrollLock.count({ where: { status: 'LOCKED' } })]);
    const before = await counts();
    await readiness(period.id);
    expect(await counts()).toEqual(before);
  });

  it('a REOPENED period is re-evaluated before it can be locked again', async () => {
    const { employee: e } = await cleanEmployee();
    const period = await openPeriod();
    await lock(period.id).expect(201);
    await http().post(`/payroll-locks/${period.id}/unlock`).set('Authorization', auth('SUPER_ADMIN')).send({ reason: 'Late correction' }).expect(201);
    await pendingCorrection(e.id, '2031-03-06', actorId);
    const r = await readiness(period.id);
    expect(r).toMatchObject({ periodStatus: 'REOPENED', ready: false });
    await lock(period.id).expect(409);
  });
});
