/**
 * Unit 21 — HTTP contract + RBAC checks for the endpoints the HR web UI calls
 * (/payroll-locks and /payroll-attendance). Test-only: no backend source was changed.
 * DESTRUCTIVE only to the guarded recafco_hrms_test (truncated per test; requires
 * RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test). Synthetic future dates only.
 *
 * Tokens carry the REAL role → permission mappings from rbac.constants.ts, so these tests also
 * pin which roles the web UI will show each action to.
 */
import type { INestApplication } from '@nestjs/common';
import { DailyAttendanceStatus, EmploymentType, PunchType, PunchValidationStatus } from '@recafco/db';
import request from 'supertest';
import { ROLE_PERMISSIONS } from '../../src/auth/constants/rbac.constants';
import { accessTokenFor, createTestApp, resetDatabase } from '../support/app';
import { createAdminUser } from '../support/fixtures';
import { getTestPrismaClient } from '../support/test-prisma';

const prisma = getTestPrismaClient();

/** Unit 21.1: a lock now requires a READY period — one employee cleanly PRESENT every day of March 2031. */
async function seedCleanMarch(): Promise<void> {
  const shift = await prisma.shift.create({ data: { name: 'U21 Clean', startTimeMinutes: 420, endTimeMinutes: 960 } });
  const employee = await prisma.employee.create({
    data: { employeeCode: 'U21-CLEAN', firstName: 'Synthetic', lastName: 'Clean', employmentType: EmploymentType.FULL_TIME, hireDate: new Date('2030-01-01T00:00:00Z') },
  });
  await prisma.shiftAssignment.create({ data: { employeeId: employee.id, shiftId: shift.id, effectiveFrom: new Date('2030-01-01T00:00:00Z') } });
  for (let d = 1; d <= 31; d += 1) {
    const date = `2031-03-${String(d).padStart(2, '0')}`;
    const at = (hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00.000Z`) - 3 * 3600_000);
    const mk = (type: PunchType, t: string) =>
      prisma.attendanceRawPunch.create({
        data: { employeeId: employee.id, punchType: type, sourceType: 'MOBILE', punchTimeSource: at(t), punchTimeServer: at(t), validationStatus: PunchValidationStatus.ACCEPTED, isOfficial: true },
      });
    const pin = await mk(PunchType.IN, '07:00');
    const pout = await mk(PunchType.OUT, '16:00');
    await prisma.attendanceDailySummary.create({
      data: {
        employeeId: employee.id,
        workDate: new Date(`${date}T00:00:00Z`),
        officialInPunchId: pin.id,
        officialOutPunchId: pout.id,
        officialInTime: pin.punchTimeSource,
        officialOutTime: pout.punchTimeSource,
        totalWorkedMinutes: 540,
        status: DailyAttendanceStatus.PRESENT,
        calculatedAt: new Date(Date.now() + 1000),
      },
    });
  }
}

const PERIOD = { periodStart: '2031-03-01', periodEnd: '2031-03-31' };

describe('Unit 21 — payroll-lock + monthly attendance HTTP contract and RBAC', () => {
  let app: INestApplication;
  let actorId: string;
  const token = (role: keyof typeof ROLE_PERMISSIONS) => accessTokenFor(app, actorId, ROLE_PERMISSIONS[role]);
  const http = () => request(app.getHttpServer());

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

  it('rejects unauthenticated requests with 401', async () => {
    await http().get('/payroll-locks').expect(401);
    await http().get('/payroll-attendance/monthly?month=2031-03').expect(401);
    await http().get('/payroll-attendance/monthly/summary?month=2031-03').expect(401);
  });

  it.each(['EMPLOYEE', 'SUPERVISOR', 'DEPARTMENT_MANAGER'] as const)(
    '%s cannot read company-wide monthly attendance or payroll locks, nor mutate locks',
    async (role) => {
      const auth = `Bearer ${token(role)}`;
      await http().get('/payroll-attendance/monthly?month=2031-03').set('Authorization', auth).expect(403);
      await http().get('/payroll-attendance/monthly/summary?month=2031-03').set('Authorization', auth).expect(403);
      await http().get('/payroll-locks').set('Authorization', auth).expect(403);
      await http().post('/payroll-locks').set('Authorization', auth).send(PERIOD).expect(403);
    },
  );

  it.each(['HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER', 'AUDITOR', 'MANAGEMENT_VIEWER', 'SUPER_ADMIN'] as const)(
    '%s can read monthly attendance and payroll locks',
    async (role) => {
      const auth = `Bearer ${token(role)}`;
      const list = await http().get('/payroll-attendance/monthly?month=2031-03').set('Authorization', auth).expect(200);
      expect(list.body).toMatchObject({ data: [], meta: { page: 1, limit: 20, total: 0 } });
      const summary = await http().get('/payroll-attendance/monthly/summary?month=2031-03').set('Authorization', auth).expect(200);
      expect(summary.body).toMatchObject({ employeeCount: 0, allEmployeesCalculated: false, totals: { requiredMinutes: null, shortageMinutes: null } });
      await http().get('/payroll-locks').set('Authorization', auth).expect(200);
    },
  );

  it('read-only roles (AUDITOR, MANAGEMENT_VIEWER) cannot create, lock or unlock', async () => {
    const created = await http().post('/payroll-locks').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send(PERIOD).expect(201);
    for (const role of ['AUDITOR', 'MANAGEMENT_VIEWER'] as const) {
      const auth = `Bearer ${token(role)}`;
      await http().post('/payroll-locks').set('Authorization', auth).send({ periodStart: '2031-05-01', periodEnd: '2031-05-31' }).expect(403);
      await http().post(`/payroll-locks/${created.body.id}/lock`).set('Authorization', auth).expect(403);
      await http().post(`/payroll-locks/${created.body.id}/unlock`).set('Authorization', auth).send({ reason: 'x' }).expect(403);
    }
  });

  it('full lifecycle with the response shapes the web client relies on; only SUPER_ADMIN may unlock', async () => {
    const officer = `Bearer ${token('PAYROLL_OFFICER')}`;
    const admin = `Bearer ${token('SUPER_ADMIN')}`;
    await seedCleanMarch();

    const created = await http().post('/payroll-locks').set('Authorization', officer).send({ ...PERIOD, reason: 'March close' }).expect(201);
    expect(created.body).toMatchObject({ status: 'OPEN', reason: 'March close', lockedAt: null, reopenReason: null });
    expect(created.body.periodStart.slice(0, 10)).toBe('2031-03-01');
    expect(created.body.periodEnd.slice(0, 10)).toBe('2031-03-31');

    // Overlapping an OPEN period → 409 (the UI shows the backend message).
    const overlap = await http().post('/payroll-locks').set('Authorization', officer).send({ periodStart: '2031-03-15', periodEnd: '2031-04-15' }).expect(409);
    expect(overlap.body.message).toMatch(/overlaps/i);
    // End before start → 400.
    await http().post('/payroll-locks').set('Authorization', officer).send({ periodStart: '2031-06-30', periodEnd: '2031-06-01' }).expect(400);

    const locked = await http().post(`/payroll-locks/${created.body.id}/lock`).set('Authorization', officer).expect(201);
    expect(locked.body).toMatchObject({ lock: { status: 'LOCKED', summaryCount: 31 }, affectedSummaryCount: 31 });
    // Locking twice → 409.
    await http().post(`/payroll-locks/${created.body.id}/lock`).set('Authorization', officer).expect(409);

    // PAYROLL_OFFICER and HR roles hold payrollLocks.lock but NOT payrollLocks.unlock.
    for (const role of ['PAYROLL_OFFICER', 'HR_MANAGER', 'HR_ADMIN'] as const) {
      await http().post(`/payroll-locks/${created.body.id}/unlock`).set('Authorization', `Bearer ${token(role)}`).send({ reason: 'Fix' }).expect(403);
    }
    // Reason is mandatory.
    await http().post(`/payroll-locks/${created.body.id}/unlock`).set('Authorization', admin).send({ reason: '' }).expect(400);
    await http().post(`/payroll-locks/${created.body.id}/unlock`).set('Authorization', admin).send({}).expect(400);

    const reopened = await http().post(`/payroll-locks/${created.body.id}/unlock`).set('Authorization', admin).send({ reason: 'Late correction approved' }).expect(201);
    expect(reopened.body).toMatchObject({ lock: { status: 'REOPENED', reopenReason: 'Late correction approved' }, affectedSummaryCount: 31 });
    // Unlocking a non-locked period → 409.
    await http().post(`/payroll-locks/${created.body.id}/unlock`).set('Authorization', admin).send({ reason: 'again' }).expect(409);

    // REOPENED can be locked again.
    await http().post(`/payroll-locks/${created.body.id}/lock`).set('Authorization', officer).expect(201);

    const list = await http().get('/payroll-locks?status=LOCKED').set('Authorization', officer).expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({ id: created.body.id, status: 'LOCKED', reopenReason: 'Late correction approved' });
  });

  it('Unit 21.1: unresolved attendance now BLOCKS the lock at the backend (gap closed)', async () => {
    // Before Unit 21.1 this lock succeeded. Now the readiness check refuses it with 409.
    const officer = `Bearer ${token('PAYROLL_OFFICER')}`;
    // One synthetic employee with a shift but no attendance records in March 2031 → INCOMPLETE.
    const shift = await prisma.shift.create({ data: { name: 'U21 Day', startTimeMinutes: 420, endTimeMinutes: 960 } });
    const employee = await prisma.employee.create({
      data: { employeeCode: 'U21-0001', firstName: 'Synthetic', lastName: 'Unresolved', employmentType: EmploymentType.FULL_TIME, hireDate: new Date('2030-01-01T00:00:00Z') },
    });
    await prisma.shiftAssignment.create({ data: { employeeId: employee.id, shiftId: shift.id, effectiveFrom: new Date('2030-01-01T00:00:00Z') } });

    const before = await http().get('/payroll-attendance/monthly/summary?month=2031-03').set('Authorization', officer).expect(200);
    expect(before.body.reviewStatusCounts).toMatchObject({ INCOMPLETE: 1, CALCULATED: 0 });

    const created = await http().post('/payroll-locks').set('Authorization', officer).send(PERIOD).expect(201);
    const refused = await http().post(`/payroll-locks/${created.body.id}/lock`).set('Authorization', officer).expect(409);
    expect(refused.body).toMatchObject({ code: 'PAYROLL_PERIOD_NOT_READY', reasonCodes: ['WORK_CALENDAR_NOT_CONFIGURED'] });
    expect(refused.body.readiness.issuesByType.WORK_CALENDAR_NOT_CONFIGURED.employeeDays).toBe(31);

    // Nothing was locked: the month is still INCOMPLETE, not LOCKED.
    const after = await http().get(`/payroll-attendance/monthly/${employee.id}?month=2031-03`).set('Authorization', officer).expect(200);
    expect(after.body.reviewStatus).toBe('INCOMPLETE');
  });
});
