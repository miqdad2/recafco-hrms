/**
 * TIME-01 concurrency and payroll-lock safety. DESTRUCTIVE (truncates between tests) — guarded
 * `recafco_hrms_test` only, with RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test.
 *
 * Races are exercised with real parallel HTTP requests (repeated several rounds) and, for the
 * payroll-lock interleavings, deterministically: the test holds a real row lock in its own
 * transaction, starts the competing operation, proves it is blocked, then releases the lock.
 */
import { ConflictException, type INestApplication } from '@nestjs/common';
import { PayrollLockStatus } from '@recafco/db';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { AttendanceSummaryCalculatorService } from '../../src/attendance-summaries/attendance-summary-calculator.service';
import { ClockService } from '../../src/common/clock.service';
import { PayrollLocksService } from '../../src/payroll-locks/payroll-locks.service';
import { accessTokenFor, createTestApp, resetDatabase } from '../support/app';
import { createAdminUser, createMobileEmployee, INSIDE, type MobileEmployeeFixture } from '../support/fixtures';
import { FixedClock } from '../support/fixed-clock';
import { getTestPrismaClient } from '../support/test-prisma';

const prisma = getTestPrismaClient();
const SERVER_NOW = '2026-11-08T06:00:00.000Z';
const WORK_DATE = '2026-11-08';
const clock = new FixedClock(SERVER_NOW);
const ROUNDS = 8;
const ctx = { ipAddress: null, userAgent: null };

describe('TIME-01 concurrency and payroll-lock safety', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp([{ token: ClockService, value: clock }]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(SERVER_NOW);
    await resetDatabase();
  });

  function punch(fixture: MobileEmployeeFixture, punchType: 'IN' | 'OUT', clientRequestId = randomUUID()): request.Test {
    return request(app.getHttpServer())
      .post('/attendance-punches/mobile')
      .set('Authorization', `Bearer ${accessTokenFor(app, fixture.userId, ['attendancePunches.createMobile'])}`)
      .send({
        punchType,
        clientRequestId,
        latitude: INSIDE.latitude,
        longitude: INSIDE.longitude,
        gpsAccuracy: 10,
        deviceIdentifier: fixture.deviceIdentifier,
        fraudSignals: { mockLocationDetected: false },
      });
  }

  const daySummary = (employeeId: string) =>
    prisma.attendanceDailySummary.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: new Date(`${WORK_DATE}T00:00:00Z`) } },
    });

  it.each(['IN', 'OUT'] as const)(
    `two simultaneous %s punches (different request ids): both stored, exactly one accepted, one official — ${ROUNDS} rounds`,
    async (punchType) => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const fixture = await createMobileEmployee();
        const [a, b] = await Promise.all([punch(fixture, punchType), punch(fixture, punchType)]);
        expect([a.status, b.status]).toEqual([201, 201]);

        const rows = await prisma.attendanceRawPunch.findMany({ where: { employeeId: fixture.employeeId } });
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.validationStatus).sort()).toEqual(['ACCEPTED', 'REJECTED_DUPLICATE']);
        expect(rows.filter((r) => r.isOfficial)).toHaveLength(1);
        const accepted = rows.find((r) => r.validationStatus === 'ACCEPTED');
        const day = await daySummary(fixture.employeeId);
        expect(punchType === 'IN' ? day?.officialInPunchId : day?.officialOutPunchId).toBe(accepted?.id);
      }
    },
  );

  it(`IN and OUT arriving together: the summary always reflects BOTH (no lost update) — ${ROUNDS} rounds`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const fixture = await createMobileEmployee();
      const [inRes, outRes] = await Promise.all([punch(fixture, 'IN'), punch(fixture, 'OUT')]);
      expect(inRes.body.validationStatus).toBe('ACCEPTED');
      expect(outRes.body.validationStatus).toBe('ACCEPTED');

      const day = await daySummary(fixture.employeeId);
      expect(day?.officialInPunchId).toBe(inRes.body.id);
      expect(day?.officialOutPunchId).toBe(outRes.body.id);
      expect(day?.status).toBe('PRESENT');
      const official = await prisma.attendanceRawPunch.findMany({ where: { employeeId: fixture.employeeId, isOfficial: true } });
      expect(official.map((p) => p.id).sort()).toEqual([inRes.body.id, outRes.body.id].sort());
    }
  });

  it('a burst of 5 network retries of the same action stores one punch and recalculates once', async () => {
    const fixture = await createMobileEmployee();
    const id = randomUUID();
    const responses = await Promise.all(Array.from({ length: 5 }, () => punch(fixture, 'IN', id)));

    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(responses.filter((r) => r.headers['idempotent-replayed'] === 'false')).toHaveLength(1);
    expect(await prisma.attendanceRawPunch.count({ where: { employeeId: fixture.employeeId } })).toBe(1);
    expect((await daySummary(fixture.employeeId))?.calculationVersion).toBe(1);
  });

  it('payroll lock activated DURING a recalculation: the recalculation waits, then refuses; the summary is untouched', async () => {
    const fixture = await createMobileEmployee();
    const adminId = await createAdminUser();
    await punch(fixture, 'IN');
    const before = await daySummary(fixture.employeeId);
    const lock = await prisma.attendancePayrollLock.create({
      data: { periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-11-30T00:00:00Z'), status: PayrollLockStatus.OPEN },
    });
    const calculator = app.get(AttendanceSummaryCalculatorService);

    let outcome: unknown = 'pending';
    await prisma.$transaction(async (tx) => {
      // Exactly what PayrollLocksService.lockPeriod does first: lock the period row, flip it to LOCKED.
      await tx.$queryRawUnsafe('SELECT id FROM attendance_payroll_locks WHERE id = $1 FOR UPDATE', lock.id);
      await tx.attendancePayrollLock.update({ where: { id: lock.id }, data: { status: PayrollLockStatus.LOCKED, lockedAt: new Date() } });

      void calculator.calculateForEmployeeDate(fixture.employeeId, WORK_DATE, adminId, ctx).then(
        () => (outcome = 'completed'),
        (error: unknown) => (outcome = error),
      );
      await sleep(800);
      expect(outcome).toBe('pending'); // blocked on the period row, not racing past the check
    });

    for (let i = 0; i < 50 && outcome === 'pending'; i += 1) await sleep(100);
    expect(outcome).toBeInstanceOf(ConflictException);
    const after = await daySummary(fixture.employeeId);
    expect(after?.calculationVersion).toBe(before?.calculationVersion);
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
  });

  it('locking a period waits for an in-flight recalculation; afterwards the locked summary is immutable', async () => {
    const fixture = await createMobileEmployee();
    const adminId = await createAdminUser();
    // Unit 21.1: a lock now requires a READY period (no unresolved attendance). So this fixture
    // is a complete, exactly-one-day period: a valid shift plus both IN and OUT, calculated.
    const dayShift = await prisma.shift.create({ data: { name: 'T01 Day', startTimeMinutes: 420, endTimeMinutes: 960 } });
    await prisma.shiftAssignment.create({ data: { employeeId: fixture.employeeId, shiftId: dayShift.id, effectiveFrom: new Date('2024-01-01T00:00:00Z') } });
    await punch(fixture, 'IN').expect(201);
    clock.set('2026-11-08T12:00:00.000Z');
    await punch(fixture, 'OUT').expect(201);
    const lock = await prisma.attendancePayrollLock.create({
      data: { periodStart: new Date(`${WORK_DATE}T00:00:00Z`), periodEnd: new Date(`${WORK_DATE}T00:00:00Z`), status: PayrollLockStatus.OPEN },
    });
    const locks = app.get(PayrollLocksService);

    let lockOutcome: unknown = 'pending';
    await prisma.$transaction(async (tx) => {
      // Exactly what an in-flight recalculation holds: FOR SHARE on the covering period row.
      await tx.$queryRawUnsafe('SELECT id FROM attendance_payroll_locks WHERE id = $1 FOR SHARE', lock.id);
      void locks.lockPeriod(lock.id, adminId, ctx).then(
        () => (lockOutcome = 'locked'),
        (error: unknown) => (lockOutcome = error),
      );
      await sleep(800);
      expect(lockOutcome).toBe('pending'); // lockPeriod waits for the recalculation to finish
    });

    for (let i = 0; i < 50 && lockOutcome === 'pending'; i += 1) await sleep(100);
    expect(lockOutcome).toBe('locked');
    const locked = await daySummary(fixture.employeeId);
    expect(locked?.lockedAt).not.toBeNull();

    // Locked-period immutability: a direct recalculation and a new accepted punch both leave it untouched.
    await expect(
      app.get(AttendanceSummaryCalculatorService).calculateForEmployeeDate(fixture.employeeId, WORK_DATE, adminId, ctx),
    ).rejects.toBeInstanceOf(ConflictException);
    clock.set('2026-11-08T14:00:00.000Z');
    const late = await punch(fixture, 'OUT');
    expect(late.body.validationStatus).toBe('ACCEPTED');
    expect(late.body.isOfficial).toBe(false);
    const after = await daySummary(fixture.employeeId);
    expect(after?.officialOutPunchId).toBe(locked?.officialOutPunchId);
    expect(after?.officialOutPunchId).not.toBe(late.body.id);
    expect(after?.calculationVersion).toBe(locked?.calculationVersion);
    expect(after?.updatedAt.toISOString()).toBe(locked?.updatedAt.toISOString());
  });
});
