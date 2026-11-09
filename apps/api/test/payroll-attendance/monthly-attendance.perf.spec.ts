/**
 * Unit 20.2 — opt-in volume check (RUN_PERF=1). Seeds 2,000 synthetic employees with a full
 * 28-day month (56,000 daily summaries, 112,000 mixed-source punches) into the guarded
 * recafco_hrms_test, then times the three endpoints. Skipped by default so normal runs stay fast.
 */
import type { INestApplication } from '@nestjs/common';
import { AttendanceSourceType, DailyAttendanceStatus, EmploymentType, PunchType, PunchValidationStatus } from '@recafco/db';
import request from 'supertest';
import { accessTokenFor, createTestApp, resetDatabase } from '../support/app';
import { getTestPrismaClient } from '../support/test-prisma';

const prisma = getTestPrismaClient();
const EMPLOYEES = 2000;
const DAYS = 28;
const run = process.env.RUN_PERF === '1' ? describe : describe.skip;

run('Unit 20.2 volume check (2,000 employees × 28 days)', () => {
  let app: INestApplication;
  jest.setTimeout(600_000);

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase();
    const shift = await prisma.shift.create({ data: { name: 'Perf Day', startTimeMinutes: 420, endTimeMinutes: 960 } });
    const pad = (n: number, w: number) => String(n).padStart(w, '0');
    const empId = (i: number) => `perfemployee${pad(i, 12)}`;
    await prisma.employee.createMany({
      data: Array.from({ length: EMPLOYEES }, (_, i) => ({
        id: empId(i),
        employeeCode: `P${pad(i, 5)}`,
        firstName: 'Perf',
        lastName: `Employee ${i}`,
        employmentType: EmploymentType.FULL_TIME,
        hireDate: new Date('2025-01-01T00:00:00Z'),
      })),
    });
    await prisma.shiftAssignment.createMany({
      data: Array.from({ length: EMPLOYEES }, (_, i) => ({ employeeId: empId(i), shiftId: shift.id, effectiveFrom: new Date('2025-01-01T00:00:00Z') })),
    });
    // HR-POLICY-01: every employee on an ACTIVE 7-day test calendar (+ one ACTIVE holiday outside the
    // month), so all timings include calendar loading and per-day resolution.
    const cal = await prisma.workCalendar.create({ data: { code: 'PERF-7D', name: 'Perf 7-day', workingWeekdays: [0, 1, 2, 3, 4, 5, 6], status: 'ACTIVE', approvalReference: 'TEST', activatedAt: new Date() } });
    await prisma.workCalendarAssignment.createMany({ data: Array.from({ length: EMPLOYEES }, (_, i) => ({ calendarId: cal.id, scope: 'EMPLOYEE' as const, employeeId: empId(i), effectiveFrom: new Date('2025-01-01T00:00:00Z') })) });
    await prisma.publicHoliday.create({ data: { name: 'Perf holiday', startDate: new Date('2026-03-01T00:00:00Z'), endDate: new Date('2026-03-01T00:00:00Z'), status: 'ACTIVE', source: 'TEST', approvalReference: 'TEST', activatedAt: new Date() } });
    for (let d = 1; d <= DAYS; d += 1) {
      const date = `2026-02-${pad(d, 2)}`;
      const at = (hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00.000Z`) - 3 * 3600_000);
      const punches = Array.from({ length: EMPLOYEES }, (_, i) => [
        { id: `pi${pad(d, 2)}${pad(i, 15)}`, employeeId: empId(i), punchType: PunchType.IN, sourceType: i % 2 ? AttendanceSourceType.MOBILE : AttendanceSourceType.BIOMETRIC_DEVICE, punchTimeSource: at('07:00'), punchTimeServer: at('07:00'), validationStatus: PunchValidationStatus.ACCEPTED, isOfficial: true },
        { id: `po${pad(d, 2)}${pad(i, 15)}`, employeeId: empId(i), punchType: PunchType.OUT, sourceType: i % 3 ? AttendanceSourceType.BIOMETRIC_DEVICE : AttendanceSourceType.MOBILE, punchTimeSource: at('16:00'), punchTimeServer: at('16:00'), validationStatus: PunchValidationStatus.ACCEPTED, isOfficial: true },
      ]).flat();
      await prisma.attendanceRawPunch.createMany({ data: punches });
      await prisma.attendanceDailySummary.createMany({
        data: Array.from({ length: EMPLOYEES }, (_, i) => ({
          employeeId: empId(i),
          workDate: new Date(`${date}T00:00:00Z`),
          officialInPunchId: `pi${pad(d, 2)}${pad(i, 15)}`,
          officialOutPunchId: `po${pad(d, 2)}${pad(i, 15)}`,
          officialInTime: at('07:00'),
          officialOutTime: at('16:00'),
          totalWorkedMinutes: 540,
          status: DailyAttendanceStatus.PRESENT,
          calculatedAt: new Date(),
        })),
      });
    }
  });
  afterAll(async () => {
    await app.close();
  });

  const timed = async (label: string, path: string) => {
    const token = accessTokenFor(app, 'perf', ['payrollAttendance.read']);
    const start = process.hrtime.bigint();
    const res = await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[perf] ${label}: ${ms.toFixed(0)} ms (HTTP ${res.status})`);
    expect(res.status).toBe(200);
    return res.body;
  };

  it('list page, employee detail and company-wide aggregate at 2,000 employees', async () => {
    const page = await timed('GET /monthly?limit=100 (page 1 of 20)', '/payroll-attendance/monthly?month=2026-02&limit=100');
    expect(page.meta.total).toBe(EMPLOYEES);
    await timed('GET /monthly?limit=100 (page 20 of 20)', '/payroll-attendance/monthly?month=2026-02&limit=100&page=20');
    const one = await timed('GET /monthly/:employeeId (28-day breakdown)', '/payroll-attendance/monthly/perfemployee000000000007?month=2026-02');
    expect(one.dailyBreakdown).toHaveLength(DAYS);
    const summary = await timed('GET /monthly/summary (all 2,000 employees)', '/payroll-attendance/monthly/summary?month=2026-02');
    expect(summary.days.scheduledWorkingDays).toBe(EMPLOYEES * DAYS);
    expect(summary).toMatchObject({ employeeCount: EMPLOYEES, reviewStatusCounts: { CALCULATED: EMPLOYEES } });
    expect(summary.totals.requiredMinutes).toBe(EMPLOYEES * DAYS * 540);
  });

  it('HR-POLICY-01: calendar coverage over 2,000 employees', async () => {
    const admin = await prisma.user.create({ data: { username: 'perf-cov', passwordHash: 'not-used-in-tests' } });
    const token = accessTokenFor(app, admin.id, ['workCalendars.read']);
    const start = process.hrtime.bigint();
    const res = await request(app.getHttpServer()).get('/work-calendars/coverage?month=2026-02').set('Authorization', `Bearer ${token}`);
    console.log(`[perf] GET /work-calendars/coverage (2,000 × 28): ${(Number(process.hrtime.bigint() - start) / 1e6).toFixed(0)} ms (HTTP ${res.status})`);
    expect(res.body).toMatchObject({ employees: EMPLOYEES, fullyCoveredEmployees: EMPLOYEES });
  });

  it('Unit 21.1: readiness + enforced lock over the exact period at 2,000 employees', async () => {
    const admin = await prisma.user.create({ data: { username: 'perf-admin', passwordHash: 'not-used-in-tests' } });
    const period = await prisma.attendancePayrollLock.create({
      data: { periodStart: new Date('2026-02-01T00:00:00Z'), periodEnd: new Date('2026-02-28T00:00:00Z'), status: 'OPEN' },
    });
    const token = accessTokenFor(app, admin.id, ['payrollLocks.read', 'payrollLocks.lock']);
    const time = async (label: string, run: () => request.Test) => {
      const start = process.hrtime.bigint();
      const res = await run();
      console.log(`[perf] ${label}: ${(Number(process.hrtime.bigint() - start) / 1e6).toFixed(0)} ms (HTTP ${res.status})`);
      return res;
    };
    const ready = await time('GET /payroll-locks/:id/readiness (2,000 × 28)', () =>
      request(app.getHttpServer()).get(`/payroll-locks/${period.id}/readiness`).set('Authorization', `Bearer ${token}`),
    );
    expect(ready.body).toMatchObject({ ready: true, employeesEvaluated: EMPLOYEES, employeeDaysEvaluated: EMPLOYEES * DAYS });
    const locked = await time('POST /payroll-locks/:id/lock (readiness inside the lock transaction)', () =>
      request(app.getHttpServer()).post(`/payroll-locks/${period.id}/lock`).set('Authorization', `Bearer ${token}`),
    );
    expect(locked.status).toBe(201);
    expect(locked.body.affectedSummaryCount).toBe(EMPLOYEES * DAYS);
  });
});
