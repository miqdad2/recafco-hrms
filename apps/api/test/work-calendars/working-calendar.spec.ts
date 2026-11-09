/**
 * HR-POLICY-01 — working calendar, rest days, public holidays, (absent) leave integration, and
 * their effect on the Unit 20.2 monthly report and Unit 21.1 payroll-closing readiness.
 * DESTRUCTIVE only to the guarded recafco_hrms_test (truncated per test; requires
 * RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test). Synthetic data, future dates only.
 *
 * Week under test: 2031-03-01 (Saturday) … 2031-03-07 (Friday). All calendars here are TEST
 * fixtures — no real RECAFCO policy is assumed.
 */
import type { INestApplication } from '@nestjs/common';
import { AttendanceSourceType, DailyAttendanceStatus, EmployeeStatus, EmploymentType, PayrollLockStatus, PunchType, PunchValidationStatus } from '@recafco/db';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { ROLE_PERMISSIONS } from '../../src/auth/constants/rbac.constants';
import { PayrollLocksService } from '../../src/payroll-locks/payroll-locks.service';
import { WorkCalendarsService } from '../../src/work-calendars/work-calendars.service';
import { accessTokenFor, createTestApp, resetDatabase } from '../support/app';
import { createAdminUser } from '../support/fixtures';
import { getTestPrismaClient } from '../support/test-prisma';

const prisma = getTestPrismaClient();
const WEEK = ['2031-03-01', '2031-03-02', '2031-03-03', '2031-03-04', '2031-03-05', '2031-03-06', '2031-03-07'];
const SUN_THU = [0, 1, 2, 3, 4];
const ctx = { ipAddress: null, userAgent: null };
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const k = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00.000Z`) - 3 * 3600_000);
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
let seq = 0;
const uniq = (p: string) => `${p}${(seq += 1).toString().padStart(4, '0')}`;

describe('HR-POLICY-01 — working calendar', () => {
  let app: INestApplication;
  let actorId: string;
  const http = () => request(app.getHttpServer());
  const auth = (role: keyof typeof ROLE_PERMISSIONS) => `Bearer ${accessTokenFor(app, actorId, ROLE_PERMISSIONS[role])}`;
  const admin = () => auth('SUPER_ADMIN');

  async function employee(o: { hire?: string; termination?: string; workLocationId?: string; status?: EmployeeStatus } = {}) {
    return prisma.employee.create({
      data: {
        employeeCode: uniq('C'),
        firstName: 'Synthetic',
        lastName: uniq('Person'),
        employmentType: EmploymentType.FULL_TIME,
        hireDate: day(o.hire ?? '2030-01-01'),
        terminationDate: o.termination ? day(o.termination) : null,
        workLocationId: o.workLocationId ?? null,
        status: o.status ?? EmployeeStatus.ACTIVE,
      },
    });
  }
  const shift = (o: { start?: number; end?: number; overnight?: boolean } = {}) =>
    prisma.shift.create({ data: { name: uniq('Shift'), startTimeMinutes: o.start ?? 420, endTimeMinutes: o.end ?? 960, isOvernight: o.overnight ?? false } });
  const assignShift = (employeeId: string, shiftId: string) =>
    prisma.shiftAssignment.create({ data: { employeeId, shiftId, effectiveFrom: day('2030-01-01') } });
  const location = () =>
    prisma.workLocation.create({ data: { name: uniq('Site'), code: uniq('L'), latitude: 29.37, longitude: 47.97, geofenceRadiusMeters: 100, timezone: 'Asia/Kuwait' } });

  /** Creates a DRAFT calendar through the API and (by default) activates it as SUPER_ADMIN. */
  async function calendar(weekdays: number[], activate = true) {
    const created = await http().post('/work-calendars').set('Authorization', auth('HR_MANAGER')).send({ code: uniq('CAL'), name: 'Test calendar', workingWeekdays: weekdays }).expect(201);
    if (!activate) return created.body;
    return (await http().post(`/work-calendars/${created.body.id}/activate`).set('Authorization', admin()).send({ approvalReference: 'TEST-FIXTURE' }).expect(201)).body;
  }
  const assign = (body: Record<string, unknown>) => http().post('/work-calendars/assignments').set('Authorization', admin()).send({ scope: 'EMPLOYEE', ...body });
  async function holiday(name: string, start: string, end = start, activate = true) {
    const h = await http().post('/public-holidays').set('Authorization', auth('HR_MANAGER')).send({ name, startDate: start, endDate: end, source: 'Test fixture (not a real circular)' }).expect(201);
    if (!activate) return h.body;
    return (await http().post(`/public-holidays/${h.body.id}/activate`).set('Authorization', admin()).send({ approvalReference: 'TEST-FIXTURE' }).expect(201)).body;
  }
  async function override(body: Record<string, unknown>, activate = true) {
    const o = await http().post('/work-calendars/overrides').set('Authorization', auth('HR_MANAGER')).send({ reason: 'Test', ...body }).expect(201);
    if (!activate) return o.body;
    return (await http().post(`/work-calendars/overrides/${o.body.id}/activate`).set('Authorization', admin()).send({ approvalReference: 'TEST-FIXTURE' }).expect(201)).body;
  }
  const preview = async (employeeId: string, month = '2031-03') =>
    (await http().get(`/work-calendars/employees/${employeeId}/preview?month=${month}`).set('Authorization', auth('PAYROLL_OFFICER')).expect(200)).body;
  const dayOf = (p: { days: { date: string; resolution: Record<string, unknown> }[] }, date: string) => p.days.find((d) => d.date === date)?.resolution as Record<string, any>;

  async function seedDay(employeeId: string, date: string) {
    const pin = await prisma.attendanceRawPunch.create({
      data: { employeeId, punchType: PunchType.IN, sourceType: AttendanceSourceType.MOBILE, punchTimeSource: k(date, '07:00'), punchTimeServer: k(date, '07:00'), validationStatus: PunchValidationStatus.ACCEPTED },
    });
    const pout = await prisma.attendanceRawPunch.create({
      data: { employeeId, punchType: PunchType.OUT, sourceType: AttendanceSourceType.BIOMETRIC_DEVICE, punchTimeSource: k(date, '16:00'), punchTimeServer: k(date, '16:00'), validationStatus: PunchValidationStatus.ACCEPTED },
    });
    return prisma.attendanceDailySummary.create({
      data: {
        employeeId,
        workDate: day(date),
        officialInPunchId: pin.id,
        officialOutPunchId: pout.id,
        officialInTime: pin.punchTimeSource,
        officialOutTime: pout.punchTimeSource,
        totalWorkedMinutes: 540,
        status: DailyAttendanceStatus.PRESENT,
        calculatedAt: new Date(Date.now() + 100),
      },
    });
  }
  /** Employee on a 07:00–16:00 shift, assigned (EMPLOYEE scope) to an ACTIVE calendar from 2030-01-01. */
  async function onCalendar(weekdays = SUN_THU, o: { hire?: string; termination?: string } = {}) {
    const e = await employee(o);
    const s = await shift();
    await assignShift(e.id, s.id);
    const cal = await calendar(weekdays);
    await assign({ calendarId: cal.id, employeeId: e.id, effectiveFrom: '2030-01-01' }).expect(201);
    return { employee: e, shift: s, calendar: cal };
  }
  const openPeriod = (start = WEEK[0] as string, end = WEEK[6] as string) =>
    prisma.attendancePayrollLock.create({ data: { periodStart: day(start), periodEnd: day(end), status: PayrollLockStatus.OPEN } });
  const readiness = async (id: string) => (await http().get(`/payroll-locks/${id}/readiness`).set('Authorization', auth('PAYROLL_OFFICER')).expect(200)).body;

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

  // 1
  it('standard five-day schedule (Sun–Thu): weekdays scheduled with shift minutes, Fri/Sat rest', async () => {
    const { employee: e, calendar: cal } = await onCalendar(SUN_THU);
    const p = await preview(e.id);
    expect(p).toMatchObject({ policyVersion: 'work-calendar-resolver/1', leaveIntegration: 'NOT_AVAILABLE' });
    expect(dayOf(p, '2031-03-01')).toMatchObject({ classification: 'REST_DAY', scheduledWork: false, scheduledMinutes: 0, source: 'EMPLOYEE_CALENDAR', calendar: { id: cal.id } });
    expect(dayOf(p, '2031-03-02')).toMatchObject({ classification: 'SCHEDULED_WORKDAY', scheduledWork: true, scheduledMinutes: 540, warnings: [], conflicts: [] });
    expect(dayOf(p, '2031-03-07').classification).toBe('REST_DAY');
    expect(p.days.filter((d: any) => d.resolution.classification === 'SCHEDULED_WORKDAY')).toHaveLength(22); // 4 weeks × 5 + Sun 30 + Mon 31
  });

  // 2
  it('six-day schedule: Saturday is scheduled, only Friday is rest', async () => {
    const { employee: e } = await onCalendar([0, 1, 2, 3, 4, 6]);
    const p = await preview(e.id);
    expect(dayOf(p, '2031-03-01').classification).toBe('SCHEDULED_WORKDAY');
    expect(dayOf(p, '2031-03-07').classification).toBe('REST_DAY');
  });

  // 3
  it('employee-specific rest days: an employee override and an employee calendar both beat the shift calendar', async () => {
    const e = await employee();
    const s = await shift();
    await assignShift(e.id, s.id);
    const shiftCal = await calendar([0, 1, 2, 3, 4, 5, 6]); // everyone on this shift works daily
    await assign({ scope: 'SHIFT', calendarId: shiftCal.id, shiftId: s.id, effectiveFrom: '2030-01-01' }).expect(201);
    expect(dayOf(await preview(e.id), '2031-03-07')).toMatchObject({ classification: 'SCHEDULED_WORKDAY', source: 'SHIFT_CALENDAR' });

    await override({ employeeId: e.id, date: '2031-03-04', dayType: 'REST_DAY' });
    let p = await preview(e.id);
    expect(dayOf(p, '2031-03-04')).toMatchObject({ classification: 'REST_DAY', source: 'EMPLOYEE_DAY_OVERRIDE' });

    const own = await calendar(SUN_THU);
    await assign({ calendarId: own.id, employeeId: e.id, effectiveFrom: '2030-01-01' }).expect(201);
    p = await preview(e.id);
    expect(dayOf(p, '2031-03-07')).toMatchObject({ classification: 'REST_DAY', source: 'EMPLOYEE_CALENDAR' });
  });

  // 4
  it('different schedules at different locations via bulk assignment (one dated row per employee)', async () => {
    const [north, south] = [await location(), await location()];
    const a = await employee({ workLocationId: north.id });
    const b = await employee({ workLocationId: north.id });
    const c = await employee({ workLocationId: south.id });
    const fiveDay = await calendar(SUN_THU);
    const sixDay = await calendar([0, 1, 2, 3, 4, 6]);
    expect((await assign({ calendarId: fiveDay.id, workLocationId: north.id, effectiveFrom: '2031-01-01' }).expect(201)).body.created).toBe(2);
    expect((await assign({ calendarId: sixDay.id, workLocationId: south.id, effectiveFrom: '2031-01-01' }).expect(201)).body.created).toBe(1);
    expect(await prisma.workCalendarAssignment.count({ where: { scope: 'EMPLOYEE' } })).toBe(3);
    for (const x of [a, b]) expect(dayOf(await preview(x.id), '2031-03-01').classification).toBe('REST_DAY');
    expect(dayOf(await preview(c.id), '2031-03-01').classification).toBe('SCHEDULED_WORKDAY');
  });

  // 5, 14, 15
  it('effective-date change / transfer / historical policy change: old days keep the old calendar, rows are preserved', async () => {
    const { employee: e, calendar: oldCal } = await onCalendar(SUN_THU);
    const [first] = (await http().get(`/work-calendars/assignments?employeeId=${e.id}`).set('Authorization', admin()).expect(200)).body.data;
    // ACTIVE calendars are immutable — a policy change is a new calendar + re-assignment.
    await http().patch(`/work-calendars/${oldCal.id}`).set('Authorization', auth('HR_MANAGER')).send({ workingWeekdays: [0, 1, 2] }).expect(409);
    await http().post(`/work-calendars/assignments/${first.id}/end`).set('Authorization', admin()).send({ effectiveTo: '2031-03-03', reason: 'Transfer to new site' }).expect(201);
    const newCal = await calendar([0, 1, 2, 3, 4, 6]);
    await assign({ calendarId: newCal.id, employeeId: e.id, effectiveFrom: '2031-03-04', reason: 'New site' }).expect(201);
    const p = await preview(e.id);
    expect(dayOf(p, '2031-03-01')).toMatchObject({ classification: 'REST_DAY', calendar: { id: oldCal.id } });
    expect(dayOf(p, '2031-03-08')).toMatchObject({ classification: 'SCHEDULED_WORKDAY', calendar: { id: newCal.id } });
    expect(await prisma.workCalendarAssignment.count({ where: { employeeId: e.id } })).toBe(2);
    const ended = await prisma.workCalendarAssignment.findUniqueOrThrow({ where: { id: first.id } });
    expect(ended).toMatchObject({ endedByUserId: actorId });
    expect(ended.effectiveTo?.toISOString().slice(0, 10)).toBe('2031-03-03');
    // Overlap is refused (never auto-resolved).
    const overlap = await assign({ calendarId: oldCal.id, employeeId: e.id, effectiveFrom: '2031-03-10' }).expect(409);
    expect(overlap.body.message).toMatch(/Overlaps/);
  });

  // 6
  it('employment start/end boundaries: outside employment is NOT_EMPLOYED', async () => {
    const { employee: e } = await onCalendar(SUN_THU, { hire: '2031-03-04', termination: '2031-03-20' });
    const p = await preview(e.id);
    expect(dayOf(p, '2031-03-03')).toMatchObject({ classification: 'NOT_EMPLOYED', scheduledMinutes: null });
    expect(dayOf(p, '2031-03-04').classification).toBe('SCHEDULED_WORKDAY');
    expect(dayOf(p, '2031-03-21').classification).toBe('NOT_EMPLOYED');
  });

  // 7, 8
  it('public holiday on a scheduled day and on a rest day', async () => {
    const { employee: e } = await onCalendar(SUN_THU);
    const h1 = await holiday('Test Holiday A', '2031-03-03');
    await holiday('Test Holiday B', '2031-03-07');
    const p = await preview(e.id);
    expect(dayOf(p, '2031-03-03')).toMatchObject({ classification: 'PUBLIC_HOLIDAY', scheduledWork: false, scheduledMinutes: 0, source: 'PUBLIC_HOLIDAY', holiday: { id: h1.id } });
    expect(dayOf(p, '2031-03-07')).toMatchObject({ classification: 'PUBLIC_HOLIDAY', warnings: ['HOLIDAY_ON_REST_DAY'] });
    // A holiday range covers every day in it.
    await holiday('Test Holiday C', '2031-03-10', '2031-03-12');
    expect((await preview(e.id)).days.filter((d: any) => d.resolution.classification === 'PUBLIC_HOLIDAY')).toHaveLength(5);
  });

  // 9, 10
  it('approved leave is NOT integrated: no APPROVED_LEAVE is ever produced; ON_LEAVE status changes nothing', async () => {
    const e = await employee({ status: EmployeeStatus.ON_LEAVE });
    await assignShift(e.id, (await shift()).id);
    const cal = await calendar(SUN_THU);
    await assign({ calendarId: cal.id, employeeId: e.id, effectiveFrom: '2030-01-01' }).expect(201);
    const p = await preview(e.id);
    expect(p.leaveIntegration).toBe('NOT_AVAILABLE');
    expect(p.days.some((d: any) => d.resolution.classification === 'APPROVED_LEAVE')).toBe(false);
    expect(dayOf(p, '2031-03-02').classification).toBe('SCHEDULED_WORKDAY');
    // In readiness, the scheduled day without attendance stays an unresolved blocker (not leave, not absent).
    const period = await openPeriod('2031-03-02', '2031-03-02');
    const r = await readiness(period.id);
    expect(r.issuesByType.SCHEDULED_DAY_NO_ATTENDANCE).toEqual(expect.objectContaining({ severity: 'BLOCKING', employeeDays: 1 }));
    expect(r.issuesByType.ABSENT_NOT_HR_CONFIRMED).toBeUndefined();
  });

  // 11
  it('missing calendar → UNKNOWN (never zero minutes); coverage lists the employee', async () => {
    const e = await employee();
    await assignShift(e.id, (await shift()).id);
    const p = await preview(e.id);
    expect(dayOf(p, '2031-03-02')).toMatchObject({ classification: 'UNKNOWN', scheduledWork: null, scheduledMinutes: null, source: 'NONE', warnings: ['NO_CALENDAR_ASSIGNED'] });
    await onCalendar(SUN_THU);
    const cov = (await http().get('/work-calendars/coverage?month=2031-03').set('Authorization', auth('HR_ADMIN')).expect(200)).body;
    expect(cov).toMatchObject({ employees: 2, fullyCoveredEmployees: 1, employeesWithUnknownDays: 1, employeesWithConflicts: 0 });
    expect(cov.sample).toEqual([expect.objectContaining({ employeeId: e.id, unknownDays: 31 })]);
  });

  // 12
  it('conflicting assignments or overrides → UNKNOWN with a conflict code, and readiness blocks', async () => {
    const { employee: e } = await onCalendar(SUN_THU);
    const other = await calendar([0, 1, 2, 3, 4, 5, 6]);
    // The API refuses overlaps; simulate legacy/direct data to prove the resolver flags it.
    await prisma.workCalendarAssignment.create({ data: { calendarId: other.id, scope: 'EMPLOYEE', employeeId: e.id, effectiveFrom: day('2031-03-05'), effectiveTo: day('2031-03-05') } });
    const p = await preview(e.id);
    expect(dayOf(p, '2031-03-05')).toMatchObject({ classification: 'UNKNOWN', conflicts: ['EMPLOYEE_CALENDAR_ASSIGNMENT_CONFLICT'] });
    expect(dayOf(p, '2031-03-04').classification).toBe('SCHEDULED_WORKDAY');

    await override({ employeeId: e.id, date: '2031-03-03', dayType: 'REST_DAY' });
    await override({ employeeId: e.id, date: '2031-03-03', dayType: 'WORKING_DAY' });
    expect(dayOf(await preview(e.id), '2031-03-03').conflicts).toEqual(['EMPLOYEE_DAY_OVERRIDE_CONFLICT']);

    for (const d of WEEK) await seedDay(e.id, d);
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r.issuesByType.WORK_CALENDAR_CONFLICT).toEqual(expect.objectContaining({ severity: 'BLOCKING', employeeDays: 2 }));
  });

  // 13
  it('overnight shift: the day is owned by the shift START date; ownership rule flagged as pending', async () => {
    const e = await employee();
    const night = await shift({ start: 1260, end: 300, overnight: true });
    await assignShift(e.id, night.id);
    const cal = await calendar(SUN_THU);
    await assign({ calendarId: cal.id, employeeId: e.id, effectiveFrom: '2030-01-01' }).expect(201);
    const p = await preview(e.id);
    expect(dayOf(p, '2031-03-06')).toMatchObject({ classification: 'SCHEDULED_WORKDAY', scheduledMinutes: 480, warnings: ['OVERNIGHT_SHIFT_OWNERSHIP_PENDING'] });
    expect(dayOf(p, '2031-03-07').classification).toBe('REST_DAY'); // Thursday-night shift does not make Friday a workday
  });

  // 16
  it('unapproved policy remains inactive: drafts have no effect, cannot be assigned, need approval + permission', async () => {
    const e = await employee();
    await assignShift(e.id, (await shift()).id);
    const draft = await calendar(SUN_THU, false);
    expect(draft.status).toBe('DRAFT');
    await assign({ calendarId: draft.id, employeeId: e.id, effectiveFrom: '2030-01-01' }).expect(409);
    await http().post(`/work-calendars/${draft.id}/activate`).set('Authorization', admin()).send({}).expect(400);
    await http().post(`/work-calendars/${draft.id}/activate`).set('Authorization', auth('HR_MANAGER')).send({ approvalReference: 'x' }).expect(403);

    await holiday('Draft holiday', '2031-03-03', '2031-03-03', false);
    await override({ employeeId: e.id, date: '2031-03-04', dayType: 'REST_DAY' }, false);
    const p = await preview(e.id);
    expect(p.days.every((d: any) => d.resolution.classification === 'UNKNOWN')).toBe(true);

    const noSource = await http().post('/public-holidays').set('Authorization', auth('HR_MANAGER')).send({ name: 'No source', startDate: '2031-04-01', endDate: '2031-04-01' }).expect(201);
    const refused = await http().post(`/public-holidays/${noSource.body.id}/activate`).set('Authorization', admin()).send({ approvalReference: 'x' }).expect(400);
    expect(refused.body.message).toMatch(/source/);
    // The database itself refuses an ACTIVE row without approval facts.
    await expect(prisma.publicHoliday.update({ where: { id: noSource.body.id }, data: { status: 'ACTIVE' } })).rejects.toThrow();
  });

  // 17, 18
  it('monthly report: rest day without punches is resolved (0 required); scheduled day without punches is SCHEDULED_DAY_NO_ATTENDANCE, never absent', async () => {
    const { employee: e } = await onCalendar(SUN_THU);
    for (const d of ['2031-03-02', '2031-03-04', '2031-03-05', '2031-03-06']) await seedDay(e.id, d); // 03-03 (Mon) missed
    const body = (await http().get(`/payroll-attendance/monthly/${e.id}?month=2031-03`).set('Authorization', auth('PAYROLL_OFFICER')).expect(200)).body;
    const d = (date: string) => body.dailyBreakdown.find((x: any) => x.workDate === date);
    expect(d('2031-03-01')).toMatchObject({ coverage: 'NON_WORKING_DAY', exceptions: [], requiredMinutes: 0, workedMinutes: 0, shortageMinutes: 0, calendar: { classification: 'REST_DAY' } });
    expect(d('2031-03-03')).toMatchObject({ coverage: 'NO_DAILY_SUMMARY', exceptions: ['SCHEDULED_DAY_NO_ATTENDANCE'], requiredMinutes: 540, workedMinutes: null, shortageMinutes: null, attendanceStatus: null });
    expect(body.days.absentDays).toBe(0);
    expect(body.reviewStatus).toBe('INCOMPLETE');
    expect(body.exceptions.codes).not.toContain('REST_DAY_CALENDAR_NOT_CONFIGURED');
    expect(body.totals.shortageMinutes).toBeNull(); // unresolved day keeps the month provisional
    expect(body.rulesVersion).toBe('monthly-attendance-basis/2');
  });

  // 19
  it('payroll closing with verified rest days: READY and locks (rest days no longer block)', async () => {
    const { employee: e } = await onCalendar(SUN_THU);
    for (const d of WEEK.slice(1, 6)) await seedDay(e.id, d); // Sun–Thu attended; Sat/Fri rest, no punches
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r).toMatchObject({ ready: true, blockingIssueCount: 0, employeeDaysEvaluated: 7 });
    await http().post(`/payroll-locks/${period.id}/lock`).set('Authorization', auth('PAYROLL_OFFICER')).expect(201);
  });

  // 20
  it('payroll closing with unresolved working days: scheduled-but-absent and UNKNOWN days still block (409)', async () => {
    const { employee: e } = await onCalendar(SUN_THU);
    for (const d of WEEK.slice(2, 6)) await seedDay(e.id, d); // Sunday 03-02 missing
    const noCal = await employee();
    await assignShift(noCal.id, (await shift()).id);
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r.ready).toBe(false);
    expect(r.issuesByType.SCHEDULED_DAY_NO_ATTENDANCE).toEqual(expect.objectContaining({ employeeDays: 1, employees: 1 }));
    expect(r.issuesByType.WORK_CALENDAR_NOT_CONFIGURED).toEqual(expect.objectContaining({ employeeDays: 7, employees: 1 }));
    await http().post(`/payroll-locks/${period.id}/lock`).set('Authorization', admin()).expect(409);
  });

  it('attendance on a verified rest day blocks closing until a compensation rule exists (WORK_ON_NON_WORKING_DAY)', async () => {
    const { employee: e } = await onCalendar(SUN_THU);
    for (const d of WEEK) await seedDay(e.id, d); // also worked Sat and Fri
    const period = await openPeriod();
    const r = await readiness(period.id);
    expect(r.issuesByType.WORK_ON_NON_WORKING_DAY).toEqual(expect.objectContaining({ severity: 'BLOCKING', employeeDays: 2 }));
  });

  // 21
  it('monthly totals across a calendar change are determinable and exact', async () => {
    const e = await employee();
    await assignShift(e.id, (await shift()).id);
    const a = await calendar(SUN_THU);
    const b = await calendar([0, 1, 2, 3, 4, 6]);
    await assign({ calendarId: a.id, employeeId: e.id, effectiveFrom: '2030-01-01', effectiveTo: '2031-03-15' }).expect(201);
    await assign({ calendarId: b.id, employeeId: e.id, effectiveFrom: '2031-03-16' }).expect(201);
    const dates = Array.from({ length: 31 }, (_, i) => `2031-03-${String(i + 1).padStart(2, '0')}`);
    const scheduled = dates.filter((d) => (d <= '2031-03-15' ? SUN_THU : [0, 1, 2, 3, 4, 6]).includes(weekdayOf(d)));
    for (const d of scheduled) await seedDay(e.id, d);
    const body = (await http().get(`/payroll-attendance/monthly/${e.id}?month=2031-03`).set('Authorization', auth('PAYROLL_OFFICER')).expect(200)).body;
    expect(body).toMatchObject({
      reviewStatus: 'CALCULATED',
      totals: { requiredMinutes: scheduled.length * 540, shortageMinutes: 0, verifiedWorkedMinutes: scheduled.length * 540 },
      days: { scheduledWorkingDays: scheduled.length, restDays: 31 - scheduled.length, unknownCalendarDays: 0 },
    });
    const summary = (await http().get('/payroll-attendance/monthly/summary?month=2031-03').set('Authorization', auth('PAYROLL_OFFICER')).expect(200)).body;
    expect(summary.days.scheduledWorkingDays).toBe(scheduled.length);
    expect(summary.totals.requiredMinutes).toBe(scheduled.length * 540);
  });

  // 22
  it('unauthorized policy modifications: 401 / 403 by role; HR can draft but not activate or assign', async () => {
    await http().get('/work-calendars').expect(401);
    for (const role of ['EMPLOYEE', 'SUPERVISOR', 'DEPARTMENT_MANAGER'] as const) {
      await http().get('/work-calendars').set('Authorization', auth(role)).expect(403);
      await http().get('/public-holidays').set('Authorization', auth(role)).expect(403);
      await http().post('/work-calendars').set('Authorization', auth(role)).send({ code: 'X1', name: 'x', workingWeekdays: [] }).expect(403);
    }
    for (const role of ['AUDITOR', 'MANAGEMENT_VIEWER', 'PAYROLL_OFFICER'] as const) {
      await http().get('/work-calendars').set('Authorization', auth(role)).expect(200);
      await http().post('/public-holidays').set('Authorization', auth(role)).send({ name: 'x', startDate: '2031-01-01', endDate: '2031-01-01' }).expect(403);
    }
    const draft = await calendar(SUN_THU, false);
    const e = await employee();
    for (const role of ['HR_ADMIN', 'HR_MANAGER'] as const) {
      await http().post(`/work-calendars/${draft.id}/activate`).set('Authorization', auth(role)).send({ approvalReference: 'x' }).expect(403);
      await http().post('/work-calendars/assignments').set('Authorization', auth(role)).send({ scope: 'EMPLOYEE', calendarId: draft.id, employeeId: e.id, effectiveFrom: '2031-01-01' }).expect(403);
    }
    await http().post('/work-calendars').set('Authorization', auth('HR_ADMIN')).send({ code: 'BAD', name: 'x', workingWeekdays: [7] }).expect(400);
    const audits = await prisma.auditLog.count({ where: { entityType: 'WorkCalendar', action: 'WORK_CALENDAR_CREATED' } });
    expect(audits).toBe(1);
  });

  // 23a
  it('RACE: a calendar change racing a lock waits on the period row and is refused once LOCKED', async () => {
    const { employee: e } = await onCalendar(SUN_THU);
    const h = await holiday('Race holiday', '2031-03-04', '2031-03-04', false);
    const period = await openPeriod();
    const svc = app.get(WorkCalendarsService);
    let outcome: 'pending' | 'done' | 'refused' = 'pending';
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM attendance_payroll_locks WHERE id = $1 FOR UPDATE', period.id);
      void svc.activateHoliday(h.id, { approvalReference: 'x' }, actorId, ctx).then(
        () => (outcome = 'done'),
        () => (outcome = 'refused'),
      );
      await sleep(400);
      expect(outcome).toBe('pending');
      await tx.attendancePayrollLock.update({ where: { id: period.id }, data: { status: PayrollLockStatus.LOCKED, lockedAt: new Date() } });
    });
    for (let i = 0; i < 100 && outcome === 'pending'; i += 1) await sleep(50);
    expect(outcome).toBe('refused');
    expect((await prisma.publicHoliday.findUniqueOrThrow({ where: { id: h.id } })).status).toBe('DRAFT');
    expect(e.id).toBeDefined();
  });

  // 23b
  it('RACE: a lock waits for an in-flight calendar change and evaluates its result', async () => {
    const e = await employee();
    await assignShift(e.id, (await shift()).id);
    for (const d of WEEK.slice(1, 6)) await seedDay(e.id, d);
    const cal = await calendar(SUN_THU);
    const period = await openPeriod();
    const locks = app.get(PayrollLocksService);
    let outcome: 'pending' | 'locked' | 'refused' = 'pending';
    await prisma.$transaction(async (tx) => {
      // What a calendar change holds: FOR SHARE on the covering period row.
      await tx.$queryRawUnsafe('SELECT id FROM attendance_payroll_locks WHERE id = $1 FOR SHARE', period.id);
      void locks.lockPeriod(period.id, actorId, ctx).then(
        () => (outcome = 'locked'),
        () => (outcome = 'refused'),
      );
      await sleep(400);
      expect(outcome).toBe('pending');
      // The change: assign the approved calendar — Sat/Fri become verified rest days.
      await tx.workCalendarAssignment.create({ data: { calendarId: cal.id, scope: 'EMPLOYEE', employeeId: e.id, effectiveFrom: day('2030-01-01') } });
    });
    for (let i = 0; i < 100 && outcome === 'pending'; i += 1) await sleep(50);
    expect(outcome).toBe('locked'); // without the calendar the two idle days would have blocked
  });

  // 24
  it('locked-period protection: no calendar change can re-classify locked dates; allowed again after reopening', async () => {
    const { employee: e } = await onCalendar(SUN_THU);
    for (const d of WEEK.slice(1, 6)) await seedDay(e.id, d);
    const h = await holiday('Pre-existing', '2031-03-05');
    // Holiday on a scheduled day with attendance → work on holiday blocks; remove it before locking.
    await http().post(`/public-holidays/${h.id}/deactivate`).set('Authorization', admin()).send({ reason: 'Entered by mistake' }).expect(201);
    const period = await openPeriod();
    await http().post(`/payroll-locks/${period.id}/lock`).set('Authorization', auth('PAYROLL_OFFICER')).expect(201);

    const [current] = (await http().get(`/work-calendars/assignments?employeeId=${e.id}`).set('Authorization', admin()).expect(200)).body.data;
    const msg = /locked payroll period/;
    expect((await http().post(`/work-calendars/assignments/${current.id}/end`).set('Authorization', admin()).send({ effectiveTo: '2031-03-04', reason: 'x' }).expect(409)).body.message).toMatch(msg);
    const draftHoliday = await holiday('Late holiday', '2031-03-06', '2031-03-06', false);
    await http().post(`/public-holidays/${draftHoliday.id}/activate`).set('Authorization', admin()).send({ approvalReference: 'x' }).expect(409);
    const ov = await override({ employeeId: e.id, date: '2031-03-02', dayType: 'REST_DAY' }, false);
    await http().post(`/work-calendars/overrides/${ov.id}/activate`).set('Authorization', admin()).send({ approvalReference: 'x' }).expect(409);
    const other = await employee();
    const cal = await calendar(SUN_THU);
    await assign({ calendarId: cal.id, employeeId: other.id, effectiveFrom: '2031-03-01' }).expect(409);
    // Dates after the locked period are fine.
    await assign({ calendarId: cal.id, employeeId: other.id, effectiveFrom: '2031-03-08' }).expect(201);
    await http().post(`/work-calendars/assignments/${current.id}/end`).set('Authorization', admin()).send({ effectiveTo: '2031-03-20', reason: 'ok' }).expect(201);

    // Reopen with a reason → the change is allowed (and the next lock re-evaluates readiness).
    await http().post(`/payroll-locks/${period.id}/unlock`).set('Authorization', admin()).send({ reason: 'Calendar correction' }).expect(201);
    await http().post(`/public-holidays/${draftHoliday.id}/activate`).set('Authorization', admin()).send({ approvalReference: 'x' }).expect(201);
    const r = await readiness(period.id);
    expect(r.issuesByType.WORK_ON_NON_WORKING_DAY).toEqual(expect.objectContaining({ employeeDays: 1 })); // worked on the new holiday
  });

  it('calendar pattern preview works for DRAFT calendars and shows holidays/overrides without affecting anyone', async () => {
    const draft = await calendar(SUN_THU, false);
    await holiday('Preview holiday', '2031-03-03');
    const p = (await http().get(`/work-calendars/${draft.id}/preview?month=2031-03`).set('Authorization', auth('HR_MANAGER')).expect(200)).body;
    expect(p.isDraft).toBe(true);
    expect(p.days.find((d: any) => d.date === '2031-03-03')).toMatchObject({ classification: 'PUBLIC_HOLIDAY' });
    expect(p.days.find((d: any) => d.date === '2031-03-01')).toMatchObject({ classification: 'REST_DAY' });
    expect(await prisma.workCalendarAssignment.count()).toBe(0);
  });
});
