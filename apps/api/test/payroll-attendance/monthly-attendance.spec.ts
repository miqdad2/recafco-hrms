/**
 * Unit 20.2 — Monthly attendance payroll basis (read-only reporting) integration tests.
 * DESTRUCTIVE only to the guarded recafco_hrms_test (truncated between tests; requires
 * RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test). Synthetic data only.
 *
 * Month under test: 2026-02 (28 days). Times are written as Asia/Kuwait local time.
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
import request from 'supertest';
import { AttendanceSummaryCalculatorService } from '../../src/attendance-summaries/attendance-summary-calculator.service';
import { PayrollAttendanceService } from '../../src/payroll-attendance/payroll-attendance.service';
import { accessTokenFor, createTestApp, resetDatabase } from '../support/app';
import { getTestPrismaClient } from '../support/test-prisma';

const prisma = getTestPrismaClient();
const MONTH = '2026-02';
const HR = ['payrollAttendance.read'];

/** Kuwait local date + HH:MM[:SS] → UTC instant. */
const k = (date: string, time: string) => new Date(Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}.000Z`) - 3 * 3600_000);
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

let seq = 0;
const uniq = (p: string) => `${p}${(seq += 1).toString().padStart(4, '0')}`;

async function employee(opts: { hire?: string; termination?: string; departmentId?: string; workLocationId?: string } = {}) {
  return prisma.employee.create({
    data: {
      employeeCode: uniq('EMP'),
      firstName: 'Synthetic',
      lastName: uniq('Person'),
      employmentType: EmploymentType.FULL_TIME,
      hireDate: day(opts.hire ?? '2025-01-01'),
      terminationDate: opts.termination ? day(opts.termination) : null,
      departmentId: opts.departmentId ?? null,
      workLocationId: opts.workLocationId ?? null,
    },
  });
}

async function shift(opts: { start?: number; end?: number; overnight?: boolean; grace?: number; brk?: number; active?: boolean } = {}) {
  return prisma.shift.create({
    data: {
      name: uniq('Shift'),
      code: uniq('SH'),
      startTimeMinutes: opts.start ?? 420, // 07:00
      endTimeMinutes: opts.end ?? 960, // 16:00 → 540 min
      isOvernight: opts.overnight ?? false,
      gracePeriodMinutes: opts.grace ?? 0,
      breakMinutes: opts.brk ?? 0,
      isActive: opts.active ?? true,
    },
  });
}

async function assign(employeeId: string, shiftId: string, from = '2025-01-01', to?: string) {
  return prisma.shiftAssignment.create({
    data: { employeeId, shiftId, effectiveFrom: day(from), effectiveTo: to ? day(to) : null },
  });
}

/** Seeds an accepted punch pair and the stored daily summary row (values as the calculator stores them). */
async function seedDay(
  employeeId: string,
  date: string,
  o: {
    in?: string | null;
    out?: string | null;
    inSource?: AttendanceSourceType;
    outSource?: AttendanceSourceType;
    status?: DailyAttendanceStatus;
    worked?: number;
    late?: number;
    early?: number;
    ot?: number;
    lockedAt?: Date | null;
  } = {},
) {
  const inTime = o.in === undefined ? '07:00' : o.in;
  const outTime = o.out === undefined ? '16:00' : o.out;
  const mk = async (time: string | null, type: PunchType, source: AttendanceSourceType) =>
    time
      ? prisma.attendanceRawPunch.create({
          data: {
            employeeId,
            punchType: type,
            sourceType: source,
            punchTimeSource: k(date, time),
            punchTimeServer: k(date, time),
            validationStatus: PunchValidationStatus.ACCEPTED,
            isOfficial: true,
          },
        })
      : null;
  const pin = await mk(inTime, PunchType.IN, o.inSource ?? AttendanceSourceType.MOBILE);
  const pout = await mk(outTime, PunchType.OUT, o.outSource ?? AttendanceSourceType.BIOMETRIC_DEVICE);
  return prisma.attendanceDailySummary.create({
    data: {
      employeeId,
      workDate: day(date),
      officialInPunchId: pin?.id ?? null,
      officialOutPunchId: pout?.id ?? null,
      officialInTime: pin?.punchTimeSource ?? null,
      officialOutTime: pout?.punchTimeSource ?? null,
      totalWorkedMinutes: o.worked ?? 540,
      lateMinutes: o.late ?? 0,
      earlyLeaveMinutes: o.early ?? 0,
      overtimeMinutes: o.ot ?? 0,
      status: o.status ?? DailyAttendanceStatus.PRESENT,
      calculatedAt: new Date('2026-03-01T00:00:00Z'),
      lockedAt: o.lockedAt ?? null,
    },
  });
}

async function punch(employeeId: string, at: Date, status: PunchValidationStatus) {
  return prisma.attendanceRawPunch.create({
    data: { employeeId, punchType: PunchType.IN, sourceType: AttendanceSourceType.MOBILE, punchTimeSource: at, punchTimeServer: at, validationStatus: status },
  });
}

async function lockPeriod(start: string, end: string) {
  return prisma.attendancePayrollLock.create({
    data: { periodStart: day(start), periodEnd: day(end), status: PayrollLockStatus.LOCKED, lockedAt: new Date() },
  });
}

/** A fully covered, clean month for an employee hired on `hire` (all days PRESENT 07:00–16:00). */
async function cleanEmployee(hire = '2026-02-26') {
  const e = await employee({ hire });
  const s = await shift();
  await assign(e.id, s.id);
  for (let d = Number(hire.slice(8)); d <= 28; d += 1) await seedDay(e.id, `2026-02-${String(d).padStart(2, '0')}`);
  return e;
}

describe('Unit 20.2 — GET /payroll-attendance/monthly*', () => {
  let app: INestApplication;
  const get = (path: string, permissions: string[] | null = HR) => {
    const req = request(app.getHttpServer()).get(path);
    return permissions ? req.set('Authorization', `Bearer ${accessTokenFor(app, 'hr-user', permissions)}`) : req;
  };
  const detail = async (employeeId: string, month = MONTH) => {
    const res = await get(`/payroll-attendance/monthly/${employeeId}?month=${month}`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const dayOf = (body: any, date: string) => body.dailyBreakdown.find((d: any) => d.workDate === date); // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  // --- complete month, required hours, shortage, overtime, late, early --------------------------

  it('1+2. complete month with full required hours → CALCULATED, shortage 0 (still not payroll approval)', async () => {
    const e = await cleanEmployee('2026-02-26');
    const body = await detail(e.id);
    expect(body.reviewStatus).toBe('CALCULATED');
    expect(body.days).toMatchObject({ calendarDays: 28, employmentDays: 3, presentDays: 3, unresolvedDays: 0, scheduledWorkingDays: null });
    expect(body.totals).toMatchObject({ requiredMinutes: 1620, recordedWorkedMinutes: 1620, verifiedWorkedMinutes: 1620, shortageMinutes: 0 });
    expect(body.exceptions.codes).toEqual([]);
    expect(dayOf(body, '2026-02-25').coverage).toBe('NOT_EMPLOYED');
  });

  it('3+6. shortage from an early departure is reported per day', async () => {
    const e = await employee({ hire: '2026-02-28' });
    const s = await shift();
    await assign(e.id, s.id);
    await seedDay(e.id, '2026-02-28', { out: '15:00', worked: 480, early: 60 });
    const body = await detail(e.id);
    expect(body.reviewStatus).toBe('CALCULATED');
    expect(dayOf(body, '2026-02-28')).toMatchObject({ requiredMinutes: 540, workedMinutes: 480, shortageMinutes: 60, earlyLeaveMinutes: 60 });
    expect(body.totals.shortageMinutes).toBe(60);
  });

  it('4. overtime is informational and never offsets another day’s shortage', async () => {
    const e = await employee({ hire: '2026-02-27' });
    const s = await shift();
    await assign(e.id, s.id);
    await seedDay(e.id, '2026-02-27', { out: '17:00', worked: 600, ot: 60 });
    await seedDay(e.id, '2026-02-28', { out: '15:30', worked: 510, early: 30 });
    const body = await detail(e.id);
    expect(body.totals).toMatchObject({ overtimeMinutesInformational: 60, shortageMinutes: 30, requiredMinutes: 1080 });
    expect(dayOf(body, '2026-02-27').shortageMinutes).toBe(0);
  });

  it('5. late arrival: lateness is inside the shortage, not added twice', async () => {
    const e = await employee({ hire: '2026-02-28' });
    const s = await shift();
    await assign(e.id, s.id);
    await seedDay(e.id, '2026-02-28', { in: '07:20', worked: 520, late: 20, status: DailyAttendanceStatus.LATE });
    const body = await detail(e.id);
    expect(body.days.lateDays).toBe(1);
    expect(body.totals).toMatchObject({ lateMinutes: 20, shortageMinutes: 20 });
  });

  // --- mixed sources (summaries produced by the REAL NestJS calculator) --------------------------

  it.each([
    ['7. mobile IN + biometric OUT', AttendanceSourceType.MOBILE, AttendanceSourceType.BIOMETRIC_DEVICE],
    ['8. biometric IN + mobile OUT', AttendanceSourceType.BIOMETRIC_DEVICE, AttendanceSourceType.MOBILE],
  ])('%s → sources preserved in the daily breakdown', async (_label, inSource, outSource) => {
    const e = await employee({ hire: '2026-02-28' });
    const s = await shift();
    await assign(e.id, s.id);
    await prisma.attendanceRawPunch.create({ data: { employeeId: e.id, punchType: PunchType.IN, sourceType: inSource, punchTimeSource: k('2026-02-28', '06:58'), punchTimeServer: k('2026-02-28', '06:58'), validationStatus: PunchValidationStatus.ACCEPTED } });
    await prisma.attendanceRawPunch.create({ data: { employeeId: e.id, punchType: PunchType.OUT, sourceType: outSource, punchTimeSource: k('2026-02-28', '16:02'), punchTimeServer: k('2026-02-28', '16:02'), validationStatus: PunchValidationStatus.ACCEPTED } });
    const actor = await prisma.user.create({ data: { username: uniq('actor'), passwordHash: 'x' } });
    await app.get(AttendanceSummaryCalculatorService).calculateForEmployeeDate(e.id, '2026-02-28', actor.id, { ipAddress: null, userAgent: null });

    const d = dayOf(await detail(e.id), '2026-02-28');
    expect(d.officialIn.sourceType).toBe(inSource);
    expect(d.officialOut.sourceType).toBe(outSource);
    expect(d).toMatchObject({ workedMinutes: 544, requiredMinutes: 540, shortageMinutes: 0, overtimeMinutes: 2, attendanceStatus: 'PRESENT' });
  });

  // --- missing data: never a misleading zero ----------------------------------------------------

  it.each([
    ['9. missing IN', null, '16:00'],
    ['10. missing OUT', '07:00', null],
  ])('%s → MISSING_PUNCH, worked/shortage unknown (null), month INCOMPLETE', async (_label, inT, outT) => {
    const e = await employee({ hire: '2026-02-28' });
    const s = await shift();
    await assign(e.id, s.id);
    await seedDay(e.id, '2026-02-28', { in: inT, out: outT, worked: 0, status: DailyAttendanceStatus.MISSING_PUNCH });
    const body = await detail(e.id);
    expect(dayOf(body, '2026-02-28')).toMatchObject({ recordedWorkedMinutes: 0, workedMinutes: null, shortageMinutes: null, requiredMinutes: 540 });
    expect(body.reviewStatus).toBe('INCOMPLETE');
    expect(body.totals.shortageMinutes).toBeNull();
    expect(body.exceptions.codes).toContain('MISSING_PUNCH');
  });

  it('11. scheduled day without any summary → missing coverage, NOT absent, required unknown', async () => {
    const e = await employee({ hire: '2026-02-27' });
    const s = await shift();
    await assign(e.id, s.id);
    await seedDay(e.id, '2026-02-27');
    const body = await detail(e.id);
    expect(dayOf(body, '2026-02-28')).toMatchObject({ coverage: 'NO_DAILY_SUMMARY', requiredMinutes: null, shortageMinutes: null });
    expect(body.days).toMatchObject({ missingSummaryDays: 1, absentDays: 0 });
    expect(body.exceptions.codes).toEqual(expect.arrayContaining(['MISSING_DAILY_SUMMARY', 'REST_DAY_CALENDAR_NOT_CONFIGURED']));
    expect(body.totals).toMatchObject({ requiredMinutes: null, shortageMinutes: null, requiredMinutesDeterminable: 540 });
    expect(body.reviewStatus).toBe('INCOMPLETE');
  });

  it('12. no shift assignment → no assumed 8-hour day; required null', async () => {
    const e = await employee({ hire: '2026-02-28' });
    await seedDay(e.id, '2026-02-28');
    const body = await detail(e.id);
    expect(dayOf(body, '2026-02-28')).toMatchObject({ coverage: 'SUMMARY', shift: null, requiredMinutes: null, shortageMinutes: null });
    expect(body.exceptions.codes).toContain('NO_SHIFT_ASSIGNMENT');
    expect(body.totals.requiredMinutes).toBeNull();
    expect(body.days.noShiftDays).toBe(1);
  });

  it('13/14. inactive shift and overnight shift are flagged, never treated as clean', async () => {
    const inactive = await employee({ hire: '2026-02-28' });
    await assign(inactive.id, (await shift({ active: false })).id);
    await seedDay(inactive.id, '2026-02-28');
    const night = await employee({ hire: '2026-02-28' });
    await assign(night.id, (await shift({ start: 1320, end: 360, overnight: true })).id);
    await seedDay(night.id, '2026-02-28', { in: '22:00', out: null, worked: 0, status: DailyAttendanceStatus.MISSING_PUNCH });

    const a = await detail(inactive.id);
    expect(a.exceptions.codes).toContain('SHIFT_INACTIVE');
    expect(a.exceptions.shiftConfigurationProblemDays).toBe(1);
    expect(dayOf(a, '2026-02-28').shortageMinutes).toBeNull();
    const b = await detail(night.id);
    expect(b.exceptions.codes).toContain('OVERNIGHT_SHIFT_CALENDAR_SPLIT');
    expect(b.exceptions.overnightReviewDays).toBe(1);
    expect(dayOf(b, '2026-02-28').shift).toMatchObject({ startTime: '22:00', endTime: '06:00', durationMinutes: 480 });
    expect([a.reviewStatus, b.reviewStatus]).toEqual(['INCOMPLETE', 'INCOMPLETE']);
  });

  it('15/16. break and grace stored but not applied → NEEDS_REVIEW (values computed but flagged)', async () => {
    const e = await employee({ hire: '2026-02-28' });
    await assign(e.id, (await shift({ brk: 60, grace: 15 })).id);
    await seedDay(e.id, '2026-02-28', { in: '07:10', worked: 530, late: 10, status: DailyAttendanceStatus.LATE });
    const body = await detail(e.id);
    expect(body.reviewStatus).toBe('NEEDS_REVIEW');
    expect(dayOf(body, '2026-02-28').exceptions).toEqual(['BREAK_NOT_APPLIED', 'GRACE_NOT_APPLIED']);
    expect(body.totals.shortageMinutes).toBe(10);
  });

  // --- pending / rejected / corrections -----------------------------------------------------------

  it('17. pending correction makes the day unresolved', async () => {
    const e = await employee({ hire: '2026-02-28' });
    await assign(e.id, (await shift()).id);
    await seedDay(e.id, '2026-02-28', { out: null, worked: 0, status: DailyAttendanceStatus.MISSING_PUNCH });
    const requester = await prisma.user.create({ data: { username: uniq('req'), passwordHash: 'x', employeeId: e.id } });
    await prisma.attendanceCorrection.create({
      data: {
        employeeId: e.id,
        workDate: day('2026-02-28'),
        requestedByUserId: requester.id,
        reason: 'Forgot to punch out',
        status: CorrectionStatus.PENDING,
        correctionType: CorrectionType.MISSED_OUT,
        beforeSnapshot: {},
        afterSnapshot: {},
      },
    });
    const body = await detail(e.id);
    expect(body.exceptions.pendingCorrections).toBe(1);
    expect(dayOf(body, '2026-02-28').exceptions).toEqual(expect.arrayContaining(['MISSING_PUNCH', 'PENDING_CORRECTION']));
  });

  it('18/19. rejected punches warn; pending-review punches block', async () => {
    const e = await employee({ hire: '2026-02-27' });
    await assign(e.id, (await shift()).id);
    await seedDay(e.id, '2026-02-27');
    await seedDay(e.id, '2026-02-28');
    await punch(e.id, k('2026-02-27', '06:30'), PunchValidationStatus.REJECTED_OUTSIDE_LOCATION);
    await punch(e.id, k('2026-02-28', '06:40'), PunchValidationStatus.PENDING_HR_REVIEW);
    const body = await detail(e.id);
    expect(dayOf(body, '2026-02-27')).toMatchObject({ rejectedPunches: 1, blocking: false, shortageMinutes: 0 });
    expect(dayOf(body, '2026-02-28')).toMatchObject({ pendingReviewPunches: 1, blocking: true, shortageMinutes: null });
    expect(body.exceptions).toMatchObject({ rejectedPunches: 1, pendingReviewPunches: 1 });
    expect(body.reviewStatus).toBe('INCOMPLETE');
  });

  // --- payroll locks --------------------------------------------------------------------------------

  it('20. fully locked employment period → LOCKED (lock ≠ approval; exceptions still listed)', async () => {
    const e = await cleanEmployee('2026-02-27');
    await lockPeriod('2026-02-01', '2026-02-28');
    const body = await detail(e.id);
    expect(body.reviewStatus).toBe('LOCKED');
    expect(body.payrollLock).toMatchObject({ overlapsLockedPeriod: true, fullyLocked: true });
    expect(body.payrollLock.lockedDates).toHaveLength(28);
  });

  it('21. mixed locked/unlocked dates are reported precisely', async () => {
    const e = await cleanEmployee('2026-02-26');
    await lockPeriod('2026-02-01', '2026-02-26');
    const body = await detail(e.id);
    expect(body.payrollLock.fullyLocked).toBe(false);
    expect(body.payrollLock.lockedDates.at(-1)).toBe('2026-02-26');
    expect(body.days.lockedDays).toBe(1);
    expect(dayOf(body, '2026-02-26').payrollLocked).toBe(true);
    expect(dayOf(body, '2026-02-27').payrollLocked).toBe(false);
    expect(body.reviewStatus).toBe('CALCULATED');
  });

  // --- dates / history / filters / paging ---------------------------------------------------------

  it('22. Kuwait date boundaries decide which day a punch belongs to', async () => {
    const e = await employee({ hire: '2026-01-01' });
    // 2026-01-31 21:30Z is 2026-02-01 00:30 Kuwait → counted in February.
    await punch(e.id, new Date('2026-01-31T21:30:00.000Z'), PunchValidationStatus.PENDING_HR_REVIEW);
    // 2026-02-28 21:30Z is 2026-03-01 00:30 Kuwait → NOT counted in February.
    await punch(e.id, new Date('2026-02-28T21:30:00.000Z'), PunchValidationStatus.PENDING_HR_REVIEW);
    const body = await detail(e.id);
    expect(dayOf(body, '2026-02-01').pendingReviewPunches).toBe(1);
    expect(body.exceptions.pendingReviewPunches).toBe(1);
  });

  it('23. employee without any attendance history → incomplete, nothing invented', async () => {
    const e = await employee({ hire: '2025-06-01' });
    const body = await detail(e.id);
    expect(body.reviewStatus).toBe('INCOMPLETE');
    expect(body.days).toMatchObject({ employmentDays: 28, noShiftDays: 28, presentDays: 0, absentDays: 0 });
    expect(body.totals).toMatchObject({ requiredMinutes: null, shortageMinutes: null, recordedWorkedMinutes: 0, verifiedWorkedMinutes: 0 });
  });

  it('24. department and work-location filtering', async () => {
    const deptA = await prisma.department.create({ data: { name: 'Dept A' } });
    const deptB = await prisma.department.create({ data: { name: 'Dept B' } });
    const loc = await prisma.workLocation.create({ data: { name: 'Site', code: uniq('LOC'), latitude: 29, longitude: 47 } });
    const a = await employee({ departmentId: deptA.id, workLocationId: loc.id });
    await employee({ departmentId: deptB.id });
    const byDept = await get(`/payroll-attendance/monthly?month=${MONTH}&departmentId=${deptA.id}`);
    expect(byDept.body.meta.total).toBe(1);
    expect(byDept.body.data[0].employee).toMatchObject({ id: a.id, department: { name: 'Dept A' } });
    const byLoc = await get(`/payroll-attendance/monthly?month=${MONTH}&workLocationId=${loc.id}`);
    expect(byLoc.body.data.map((r: { employee: { id: string } }) => r.employee.id)).toEqual([a.id]);
  });

  it('25/26. pagination is stable and the aggregate covers ALL pages', async () => {
    for (let i = 0; i < 5; i += 1) await cleanEmployee('2026-02-27');
    const pages = await Promise.all([1, 2, 3].map((p) => get(`/payroll-attendance/monthly?month=${MONTH}&page=${p}&limit=2`)));
    expect(pages.map((p) => p.body.data.length)).toEqual([2, 2, 1]);
    expect(pages[0]?.body.meta).toMatchObject({ total: 5, totalPages: 3, limit: 2 });
    expect(pages[0]?.body.data[0].dailyBreakdown).toBeUndefined(); // list rows are summaries only
    const codes = pages.flatMap((p) => p.body.data.map((r: { employee: { employeeCode: string } }) => r.employee.employeeCode));
    expect(new Set(codes).size).toBe(5);
    expect([...codes]).toEqual([...codes].sort());

    const summary = await get(`/payroll-attendance/monthly/summary?month=${MONTH}`);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ employeeCount: 5, allEmployeesCalculated: true, reviewStatusCounts: { CALCULATED: 5 } });
    expect(summary.body.totals).toMatchObject({ requiredMinutes: 5 * 1080, recordedWorkedMinutes: 5 * 1080, shortageMinutes: 0 });
  });

  it('aggregate totals become null (not zero) when any employee is incomplete', async () => {
    await cleanEmployee('2026-02-28');
    await employee({ hire: '2026-02-28' }); // no shift, no attendance
    const summary = await get(`/payroll-attendance/monthly/summary?month=${MONTH}`);
    expect(summary.body).toMatchObject({ employeeCount: 2, allEmployeesCalculated: false, reviewStatusCounts: { CALCULATED: 1, INCOMPLETE: 1 } });
    expect(summary.body.totals).toMatchObject({ requiredMinutes: null, shortageMinutes: null, requiredMinutesDeterminable: 540 });
    expect(summary.body.exceptions.employeesByCode.NO_SHIFT_ASSIGNMENT).toBe(1);
  });

  // --- access control and validation ----------------------------------------------------------------

  it('27. an employee token (no payrollAttendance.read) is forbidden on every route', async () => {
    const e = await employee();
    const employeePerms = ['attendanceSummaries.readOwn', 'attendancePunches.readOwn'];
    for (const path of [`/payroll-attendance/monthly?month=${MONTH}`, `/payroll-attendance/monthly/summary?month=${MONTH}`, `/payroll-attendance/monthly/${e.id}?month=${MONTH}`]) {
      expect((await get(path, employeePerms)).status).toBe(403);
    }
  });

  it('28. unauthenticated requests are rejected', async () => {
    expect((await get(`/payroll-attendance/monthly?month=${MONTH}`, null)).status).toBe(401);
    expect((await get(`/payroll-attendance/monthly/summary?month=${MONTH}`, null)).status).toBe(401);
  });

  it.each(['2026-13', '2026-2', 'abc', '1999-12', ''])('29. invalid month "%s" → 400', async (month) => {
    expect((await get(`/payroll-attendance/monthly?month=${month}`)).status).toBe(400);
  });

  it('29b. limit above 100, bad ids and unknown employee are rejected', async () => {
    expect((await get(`/payroll-attendance/monthly?month=${MONTH}&limit=101`)).status).toBe(400);
    expect((await get(`/payroll-attendance/monthly?month=${MONTH}&departmentId=x;drop`)).status).toBe(400);
    expect((await get(`/payroll-attendance/monthly/not-a-valid-id!?month=${MONTH}`)).status).toBe(400);
    expect((await get(`/payroll-attendance/monthly/cm00000000000000000000000?month=${MONTH}`)).status).toBe(404);
  });

  it('30. empty period (nobody employed) → empty list, null totals', async () => {
    await employee({ hire: '2026-03-01' });
    const list = await get(`/payroll-attendance/monthly?month=${MONTH}`);
    expect(list.body.meta.total).toBe(0);
    const summary = await get(`/payroll-attendance/monthly/summary?month=${MONTH}`);
    expect(summary.body).toMatchObject({ employeeCount: 0, allEmployeesCalculated: false, totals: { requiredMinutes: null, shortageMinutes: null } });
  });

  // --- additional cases found during implementation -------------------------------------------------

  it('employment boundaries: days before hire and after termination are excluded', async () => {
    const e = await employee({ hire: '2026-02-10', termination: '2026-02-12' });
    await assign(e.id, (await shift()).id);
    for (const d of ['2026-02-10', '2026-02-11', '2026-02-12']) await seedDay(e.id, d);
    const body = await detail(e.id);
    expect(body.days.employmentDays).toBe(3);
    expect(body.reviewStatus).toBe('CALCULATED');
    expect(dayOf(body, '2026-02-13').coverage).toBe('NOT_EMPLOYED');
  });

  it('an ABSENT row from the calculator is counted but not HR-confirmed; OUT before IN is invalid', async () => {
    const e = await employee({ hire: '2026-02-27' });
    await assign(e.id, (await shift()).id);
    await seedDay(e.id, '2026-02-27', { in: null, out: null, worked: 0, status: DailyAttendanceStatus.ABSENT });
    await seedDay(e.id, '2026-02-28', { in: '07:00', out: '06:00', worked: 0 });
    const body = await detail(e.id);
    expect(body.days.absentDays).toBe(1);
    expect(dayOf(body, '2026-02-27').exceptions).toContain('ABSENT_NOT_HR_CONFIRMED');
    expect(dayOf(body, '2026-02-28')).toMatchObject({ workedMinutes: null, shortageMinutes: null });
    expect(body.exceptions.invalidSequenceDays).toBe(1);
  });

  it('ambiguous assignments (same effectiveFrom) and invalid shift configuration block the day', async () => {
    const e = await employee({ hire: '2026-02-27' });
    await assign(e.id, (await shift()).id, '2026-01-01');
    await assign(e.id, (await shift({ start: 540, end: 1080 })).id, '2026-01-01');
    await seedDay(e.id, '2026-02-27');
    const f = await employee({ hire: '2026-02-28' });
    await assign(f.id, (await shift({ start: 420, end: 960, overnight: true })).id); // contradictory: 33-hour day
    await seedDay(f.id, '2026-02-28');
    expect(dayOf(await detail(e.id), '2026-02-27').exceptions).toContain('SHIFT_ASSIGNMENT_AMBIGUOUS');
    const fd = dayOf(await detail(f.id), '2026-02-28');
    expect(fd.exceptions).toContain('SHIFT_CONFIGURATION_INVALID');
    expect(fd.requiredMinutes).toBeNull();
  });

  it('runs every read in a REPEATABLE READ, READ ONLY snapshot that PostgreSQL itself enforces', async () => {
    await employee();
    const service = app.get(PayrollAttendanceService) as unknown as {
      snapshot: <T>(fn: (tx: { $queryRawUnsafe: <R>(q: string) => Promise<R>; $executeRawUnsafe: (q: string) => Promise<number> }) => Promise<T>) => Promise<T>;
    };
    const settings = await service.snapshot((tx) =>
      tx.$queryRawUnsafe<{ iso: string; ro: string }[]>("SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro"),
    );
    expect(settings[0]).toEqual({ iso: 'repeatable read', ro: 'on' });
    await expect(
      service.snapshot((tx) => tx.$executeRawUnsafe('UPDATE employees SET "firstName" = "firstName"')),
    ).rejects.toThrow(/read-only transaction|25006/i);
  });

  it('is strictly read-only: no attendance row changes after every endpoint is called', async () => {
    const e = await cleanEmployee('2026-02-26');
    await lockPeriod('2026-02-01', '2026-02-26');
    const snapshot = async () =>
      JSON.stringify([
        await prisma.attendanceDailySummary.findMany({ orderBy: { id: 'asc' } }),
        await prisma.attendanceRawPunch.findMany({ orderBy: { id: 'asc' } }),
        await prisma.attendancePayrollLock.findMany({ orderBy: { id: 'asc' } }),
        await prisma.auditLog.count(),
      ]);
    const before = await snapshot();
    await get(`/payroll-attendance/monthly?month=${MONTH}`);
    await get(`/payroll-attendance/monthly/summary?month=${MONTH}`);
    await get(`/payroll-attendance/monthly/${e.id}?month=${MONTH}`);
    expect(await snapshot()).toBe(before);
  });
});
