import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CalendarAssignmentScope, CalendarPolicyStatus, Prisma } from '@recafco/db';
import { parseWorkDateInput } from '../attendance-summaries/kuwait-date.util';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { paginate, paginationSkip } from '../common/pagination.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { parseMonth, selectAssignment, shiftDuration, type AssignmentFact, type MonthPeriod } from '../payroll-attendance/monthly-attendance.calculator';
import { PayrollAttendanceService } from '../payroll-attendance/payroll-attendance.service';
import { PayrollLockGuardService } from '../payroll-locks/payroll-lock-guard.service';
import type {
  ActivateDto,
  CreateAssignmentDto,
  CreateDayOverrideDto,
  CreatePublicHolidayDto,
  CreateWorkCalendarDto,
  DeactivateDto,
  EndAssignmentDto,
  ListAssignmentsQueryDto,
  ListHolidaysQueryDto,
  ListOverridesQueryDto,
  UpdatePublicHolidayDto,
  UpdateWorkCalendarDto,
} from './dto/work-calendar.dto';
import { loadCalendarContext } from './work-calendar.loader';
import {
  CALENDAR_RESOLVER_VERSION,
  LEAVE_INTEGRATION_AVAILABLE,
  resolveCalendarDay,
  type CalendarContext,
  type CalendarDayResolution,
  type DayClassification,
} from './work-calendar.resolver';

type Tx = Prisma.TransactionClient;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;
const CHUNK = 250;
const SAMPLE_LIMIT = 50;
const MAX_BULK_ASSIGN = 2500;
const TX = { maxWait: 10_000, timeout: 60_000 };

function toDate(value: string, field: string): Date {
  try {
    return parseWorkDateInput(value);
  } catch {
    throw new BadRequestException(`${field} is not a valid date`);
  }
}

/**
 * HR-POLICY-01 — working-calendar administration.
 *
 * Safety model:
 *  - Calendars, holidays and day overrides are created as DRAFT and never used until ACTIVATED
 *    with an approvalReference by a user holding workCalendars.activate.
 *  - ACTIVE calendars are immutable (history-safe). Changes = new calendar + re-assignment.
 *  - Every change that alters how dates are classified runs in ONE transaction that first calls
 *    PayrollLockGuardService.assertDateRangeNotLockedInTransaction (FOR SHARE on overlapping
 *    payroll-lock rows). Locked periods can never be re-classified, and a concurrent lockPeriod
 *    either sees the committed change in its readiness evaluation or the change is refused.
 *  - Nothing is ever deleted; assignments are ended, holidays/overrides deactivated with a reason.
 */
@Injectable()
export class WorkCalendarsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly lockGuard: PayrollLockGuardService,
    private readonly payrollAttendanceService: PayrollAttendanceService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  private audit(actorUserId: string, context: RequestContext, entityType: string, entityId: string, action: string, before: unknown, after: unknown) {
    return this.auditService.record({
      actorUserId,
      entityType,
      entityId,
      action,
      beforeSnapshot: before === undefined ? undefined : toJsonSnapshot(before),
      afterSnapshot: after === undefined ? undefined : toJsonSnapshot(after),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  // ---------------------------------------------------------------- calendars

  async listCalendars() {
    const today = new Date(`${dateOnly(new Date(Date.now() + 3 * 3600_000))}T00:00:00.000Z`);
    const calendars = await this.prisma.workCalendar.findMany({ orderBy: [{ status: 'asc' }, { code: 'asc' }] });
    const counts = await this.prisma.workCalendarAssignment.groupBy({
      by: ['calendarId', 'scope'],
      where: { effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
      _count: { _all: true },
    });
    return calendars.map((c) => ({
      ...c,
      currentAssignments: {
        employees: counts.find((x) => x.calendarId === c.id && x.scope === 'EMPLOYEE')?._count._all ?? 0,
        shifts: counts.find((x) => x.calendarId === c.id && x.scope === 'SHIFT')?._count._all ?? 0,
      },
    }));
  }

  async getCalendar(id: string) {
    const calendar = await this.prisma.workCalendar.findUnique({ where: { id } });
    if (!calendar) throw new NotFoundException('Working calendar not found');
    return calendar;
  }

  async createCalendar(dto: CreateWorkCalendarDto, actorUserId: string, context: RequestContext) {
    const existing = await this.prisma.workCalendar.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('A working calendar with this code already exists');
    const calendar = await this.prisma.workCalendar.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        workingWeekdays: [...dto.workingWeekdays].sort(),
        status: CalendarPolicyStatus.DRAFT,
        createdByUserId: actorUserId,
      },
    });
    await this.audit(actorUserId, context, 'WorkCalendar', calendar.id, 'WORK_CALENDAR_CREATED', undefined, calendar);
    return calendar;
  }

  async updateCalendar(id: string, dto: UpdateWorkCalendarDto, actorUserId: string, context: RequestContext) {
    const before = await this.getCalendar(id);
    if (before.status !== CalendarPolicyStatus.DRAFT) {
      throw new ConflictException('Only a DRAFT calendar can be edited. An ACTIVE calendar is fixed: create a new calendar and re-assign from an effective date.');
    }
    const data: Prisma.WorkCalendarUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.workingWeekdays !== undefined) data.workingWeekdays = [...dto.workingWeekdays].sort();
    const calendar = await this.prisma.workCalendar.update({ where: { id, status: CalendarPolicyStatus.DRAFT }, data });
    await this.audit(actorUserId, context, 'WorkCalendar', id, 'WORK_CALENDAR_UPDATED', before, calendar);
    return calendar;
  }

  /** Activation alone changes no classification: assignments can only reference ACTIVE calendars. */
  async activateCalendar(id: string, dto: ActivateDto, actorUserId: string, context: RequestContext) {
    const before = await this.getCalendar(id);
    if (before.status !== CalendarPolicyStatus.DRAFT) throw new ConflictException('Only a DRAFT calendar can be activated');
    const calendar = await this.prisma.workCalendar.update({
      where: { id, status: CalendarPolicyStatus.DRAFT },
      data: { status: CalendarPolicyStatus.ACTIVE, approvalReference: dto.approvalReference, activatedByUserId: actorUserId, activatedAt: new Date() },
    });
    await this.audit(actorUserId, context, 'WorkCalendar', id, 'WORK_CALENDAR_ACTIVATED', before, calendar);
    return calendar;
  }

  /** Month preview of a calendar's own pattern (DRAFT or ACTIVE) + ACTIVE holidays + its overrides. */
  async previewCalendar(id: string, month: string) {
    const calendar = await this.getCalendar(id);
    const period = parseMonth(month);
    const [holidays, overrides] = await Promise.all([
      this.prisma.publicHoliday.findMany({
        where: { status: CalendarPolicyStatus.ACTIVE, startDate: { lte: new Date(`${period.periodEnd}T00:00:00Z`) }, endDate: { gte: new Date(`${period.periodStart}T00:00:00Z`) } },
      }),
      this.prisma.workCalendarDayOverride.findMany({
        where: { calendarId: id, status: CalendarPolicyStatus.ACTIVE, date: { gte: new Date(`${period.periodStart}T00:00:00Z`), lte: new Date(`${period.periodEnd}T00:00:00Z`) } },
      }),
    ]);
    const ctx: CalendarContext = {
      calendarsById: new Map([[calendar.id, { id: calendar.id, code: calendar.code, name: calendar.name, workingWeekdays: calendar.workingWeekdays }]]),
      employeeAssignments: new Map([['preview', [{ id: 'preview', calendarId: calendar.id, effectiveFrom: '0000-01-01', effectiveTo: null }]]]),
      shiftAssignments: new Map(),
      calendarOverrides: new Map([[calendar.id, overrides.map((o) => ({ id: o.id, date: dateOnly(o.date), dayType: o.dayType }))]]),
      employeeOverrides: new Map(),
      holidays: holidays.map((h) => ({ id: h.id, name: h.name, startDate: dateOnly(h.startDate), endDate: dateOnly(h.endDate) })),
    };
    const days = period.dates.map((date) => {
      const r = resolveCalendarDay(ctx, { employeeId: 'preview', date, employed: true, shift: null, shiftAmbiguous: false });
      // Minutes depend on each employee's shift; the pattern preview reports classification only.
      return { date, classification: r.classification, source: r.source, holiday: r.holiday, overrideId: r.overrideId, warnings: r.warnings.filter((w) => w !== 'SCHEDULED_MINUTES_UNKNOWN') };
    });
    return { calendar, month, policyVersion: CALENDAR_RESOLVER_VERSION, isDraft: calendar.status !== CalendarPolicyStatus.ACTIVE, days };
  }

  // ---------------------------------------------------------------- assignments

  async listAssignments(query: ListAssignmentsQueryDto) {
    const today = new Date(`${dateOnly(new Date(Date.now() + 3 * 3600_000))}T00:00:00.000Z`);
    const where: Prisma.WorkCalendarAssignmentWhereInput = {};
    if (query.calendarId) where.calendarId = query.calendarId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.shiftId) where.shiftId = query.shiftId;
    if (query.view === 'current') where.OR = [{ effectiveTo: null }, { effectiveTo: { gte: today } }];
    const [data, total] = await Promise.all([
      this.prisma.workCalendarAssignment.findMany({
        where,
        include: {
          calendar: { select: { id: true, code: true, name: true } },
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          shift: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }],
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.workCalendarAssignment.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  async createAssignment(dto: CreateAssignmentDto, actorUserId: string, context: RequestContext) {
    const from = toDate(dto.effectiveFrom, 'effectiveFrom');
    const to = dto.effectiveTo ? toDate(dto.effectiveTo, 'effectiveTo') : null;
    if (to && to < from) throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    const calendar = await this.getCalendar(dto.calendarId);
    if (calendar.status !== CalendarPolicyStatus.ACTIVE) {
      throw new ConflictException('Only an ACTIVE (approved) calendar can be assigned. Activate it first.');
    }

    let employeeIds: string[] = [];
    if (dto.scope === CalendarAssignmentScope.EMPLOYEE) {
      if ((dto.employeeId ? 1 : 0) + (dto.workLocationId ? 1 : 0) !== 1 || dto.shiftId) {
        throw new BadRequestException('EMPLOYEE scope needs exactly one of employeeId or workLocationId');
      }
      if (dto.employeeId) {
        const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true } });
        if (!employee) throw new BadRequestException('employeeId does not reference an existing employee');
        employeeIds = [employee.id];
      } else {
        // Bulk convenience: one explicit, dated EMPLOYEE assignment per employee CURRENTLY at the
        // location and employed during the range (location history is not tracked, so the
        // resulting per-employee rows ARE the history).
        const employees = await this.prisma.employee.findMany({
          where: {
            workLocationId: dto.workLocationId as string,
            deletedAt: null,
            ...(to ? { hireDate: { lte: to } } : {}),
            OR: [{ terminationDate: null }, { terminationDate: { gte: from } }],
          },
          select: { id: true },
        });
        if (employees.length === 0) throw new BadRequestException('No employees at this work location are employed in that date range');
        if (employees.length > MAX_BULK_ASSIGN) throw new BadRequestException(`At most ${MAX_BULK_ASSIGN} employees per bulk assignment`);
        employeeIds = employees.map((e) => e.id);
      }
    } else {
      if (!dto.shiftId || dto.employeeId || dto.workLocationId) throw new BadRequestException('SHIFT scope needs shiftId only');
      const shift = await this.prisma.shift.findUnique({ where: { id: dto.shiftId }, select: { id: true } });
      if (!shift) throw new BadRequestException('shiftId does not reference an existing shift');
    }

    const overlapWhere = (target: Prisma.WorkCalendarAssignmentWhereInput): Prisma.WorkCalendarAssignmentWhereInput => ({
      ...target,
      scope: dto.scope,
      ...(to ? { effectiveFrom: { lte: to } } : {}),
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
    });

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockGuard.assertDateRangeNotLockedInTransaction(tx, from, to);
      const target: Prisma.WorkCalendarAssignmentWhereInput =
        dto.scope === CalendarAssignmentScope.EMPLOYEE ? { employeeId: { in: employeeIds } } : { shiftId: dto.shiftId as string };
      const overlapping = await tx.workCalendarAssignment.findMany({
        where: overlapWhere(target),
        select: { employeeId: true, shiftId: true, effectiveFrom: true, effectiveTo: true },
        take: 20,
      });
      if (overlapping.length > 0) {
        const codes =
          dto.scope === CalendarAssignmentScope.EMPLOYEE
            ? (await tx.employee.findMany({ where: { id: { in: overlapping.map((o) => o.employeeId as string) } }, select: { employeeCode: true } })).map((e) => e.employeeCode)
            : ['(shift)'];
        throw new ConflictException(
          `Overlaps an existing calendar assignment for: ${codes.join(', ')}. End the existing assignment first (no assignment is changed automatically).`,
        );
      }
      const base = { calendarId: calendar.id, scope: dto.scope, effectiveFrom: from, effectiveTo: to, reason: dto.reason ?? null, createdByUserId: actorUserId };
      if (dto.scope === CalendarAssignmentScope.SHIFT) {
        return [await tx.workCalendarAssignment.create({ data: { ...base, shiftId: dto.shiftId as string } })];
      }
      await tx.workCalendarAssignment.createMany({ data: employeeIds.map((employeeId) => ({ ...base, employeeId })) });
      return tx.workCalendarAssignment.findMany({ where: { ...base, employeeId: { in: employeeIds }, effectiveFrom: from } });
    }, TX);

    await this.audit(actorUserId, context, 'WorkCalendarAssignment', created.length === 1 ? (created[0]?.id as string) : `bulk-${calendar.id}`, 'WORK_CALENDAR_ASSIGNED', undefined, {
      calendarId: calendar.id,
      calendarCode: calendar.code,
      scope: dto.scope,
      workLocationId: dto.workLocationId ?? null,
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo ?? null,
      reason: dto.reason ?? null,
      assignmentIds: created.map((a) => a.id),
    });
    return { created: created.length, assignments: created.slice(0, 50) };
  }

  /** Shortens (ends) an assignment. The affected days (after the new end) must not be locked. */
  async endAssignment(id: string, dto: EndAssignmentDto, actorUserId: string, context: RequestContext) {
    const before = await this.prisma.workCalendarAssignment.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Calendar assignment not found');
    const newTo = toDate(dto.effectiveTo, 'effectiveTo');
    if (newTo < before.effectiveFrom) throw new BadRequestException('effectiveTo cannot be before the assignment starts');
    if (before.effectiveTo && newTo >= before.effectiveTo) throw new BadRequestException('An assignment can only be shortened');
    const affectedFrom = new Date(newTo.getTime() + DAY_MS);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockGuard.assertDateRangeNotLockedInTransaction(tx, affectedFrom, before.effectiveTo);
      return tx.workCalendarAssignment.update({
        where: { id },
        data: { effectiveTo: newTo, endedByUserId: actorUserId, endedAt: new Date(), reason: before.reason ? `${before.reason} | ended: ${dto.reason}` : `ended: ${dto.reason}` },
      });
    }, TX);
    await this.audit(actorUserId, context, 'WorkCalendarAssignment', id, 'WORK_CALENDAR_ASSIGNMENT_ENDED', before, { ...updated, endReason: dto.reason });
    return updated;
  }

  // ---------------------------------------------------------------- day overrides

  listOverrides(query: ListOverridesQueryDto) {
    return this.prisma.workCalendarDayOverride.findMany({
      where: { ...(query.calendarId ? { calendarId: query.calendarId } : {}), ...(query.employeeId ? { employeeId: query.employeeId } : {}), ...(query.status ? { status: query.status } : {}) },
      include: { calendar: { select: { code: true, name: true } }, employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
      orderBy: [{ date: 'desc' }],
      take: 200,
    });
  }

  async createOverride(dto: CreateDayOverrideDto, actorUserId: string, context: RequestContext) {
    if ((dto.calendarId ? 1 : 0) + (dto.employeeId ? 1 : 0) !== 1) throw new BadRequestException('Give exactly one of calendarId or employeeId');
    if (dto.calendarId) await this.getCalendar(dto.calendarId);
    if (dto.employeeId && !(await this.prisma.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true } }))) {
      throw new BadRequestException('employeeId does not reference an existing employee');
    }
    const override = await this.prisma.workCalendarDayOverride.create({
      data: {
        calendarId: dto.calendarId ?? null,
        employeeId: dto.employeeId ?? null,
        date: toDate(dto.date, 'date'),
        dayType: dto.dayType,
        reason: dto.reason,
        status: CalendarPolicyStatus.DRAFT,
        createdByUserId: actorUserId,
      },
    });
    await this.audit(actorUserId, context, 'WorkCalendarDayOverride', override.id, 'WORK_CALENDAR_OVERRIDE_CREATED', undefined, override);
    return override;
  }

  async activateOverride(id: string, dto: ActivateDto, actorUserId: string, context: RequestContext) {
    const before = await this.prisma.workCalendarDayOverride.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Day override not found');
    if (before.status !== CalendarPolicyStatus.DRAFT) throw new ConflictException('Only a DRAFT override can be activated');
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockGuard.assertDateRangeNotLockedInTransaction(tx, before.date, before.date);
      return tx.workCalendarDayOverride.update({
        where: { id, status: CalendarPolicyStatus.DRAFT },
        data: { status: CalendarPolicyStatus.ACTIVE, approvalReference: dto.approvalReference, activatedByUserId: actorUserId, activatedAt: new Date() },
      });
    }, TX);
    await this.audit(actorUserId, context, 'WorkCalendarDayOverride', id, 'WORK_CALENDAR_OVERRIDE_ACTIVATED', before, updated);
    return updated;
  }

  async deactivateOverride(id: string, dto: DeactivateDto, actorUserId: string, context: RequestContext) {
    const before = await this.prisma.workCalendarDayOverride.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Day override not found');
    if (before.status === CalendarPolicyStatus.INACTIVE) throw new ConflictException('This override is already inactive');
    const updated = await this.prisma.$transaction(async (tx) => {
      if (before.status === CalendarPolicyStatus.ACTIVE) await this.lockGuard.assertDateRangeNotLockedInTransaction(tx, before.date, before.date);
      return tx.workCalendarDayOverride.update({
        where: { id },
        data: { status: CalendarPolicyStatus.INACTIVE, deactivatedByUserId: actorUserId, deactivatedAt: new Date(), deactivationReason: dto.reason },
      });
    }, TX);
    await this.audit(actorUserId, context, 'WorkCalendarDayOverride', id, 'WORK_CALENDAR_OVERRIDE_DEACTIVATED', before, updated);
    return updated;
  }

  // ---------------------------------------------------------------- public holidays

  listHolidays(query: ListHolidaysQueryDto) {
    const where: Prisma.PublicHolidayWhereInput = {};
    if (query.year) {
      where.startDate = { lte: new Date(Date.UTC(query.year, 11, 31)) };
      where.endDate = { gte: new Date(Date.UTC(query.year, 0, 1)) };
    }
    if (query.status) where.status = query.status;
    return this.prisma.publicHoliday.findMany({ where, orderBy: [{ startDate: 'asc' }], take: 500 });
  }

  async createHoliday(dto: CreatePublicHolidayDto, actorUserId: string, context: RequestContext) {
    const start = toDate(dto.startDate, 'startDate');
    const end = toDate(dto.endDate, 'endDate');
    if (end < start) throw new BadRequestException('endDate must be on or after startDate');
    const holiday = await this.prisma.publicHoliday.create({
      data: { name: dto.name, startDate: start, endDate: end, source: dto.source ?? null, notes: dto.notes ?? null, status: CalendarPolicyStatus.DRAFT, createdByUserId: actorUserId },
    });
    await this.audit(actorUserId, context, 'PublicHoliday', holiday.id, 'PUBLIC_HOLIDAY_CREATED', undefined, holiday);
    return holiday;
  }

  async updateHoliday(id: string, dto: UpdatePublicHolidayDto, actorUserId: string, context: RequestContext) {
    const before = await this.prisma.publicHoliday.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Public holiday not found');
    if (before.status !== CalendarPolicyStatus.DRAFT) throw new ConflictException('Only a DRAFT holiday can be edited. Deactivate it (with a reason) and create a corrected one.');
    const start = dto.startDate ? toDate(dto.startDate, 'startDate') : before.startDate;
    const end = dto.endDate ? toDate(dto.endDate, 'endDate') : before.endDate;
    if (end < start) throw new BadRequestException('endDate must be on or after startDate');
    const updated = await this.prisma.publicHoliday.update({
      where: { id, status: CalendarPolicyStatus.DRAFT },
      data: { name: dto.name ?? before.name, startDate: start, endDate: end, source: dto.source ?? before.source, notes: dto.notes ?? before.notes },
    });
    await this.audit(actorUserId, context, 'PublicHoliday', id, 'PUBLIC_HOLIDAY_UPDATED', before, updated);
    return updated;
  }

  async activateHoliday(id: string, dto: ActivateDto, actorUserId: string, context: RequestContext) {
    const before = await this.prisma.publicHoliday.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Public holiday not found');
    if (before.status !== CalendarPolicyStatus.DRAFT) throw new ConflictException('Only a DRAFT holiday can be activated');
    if (!before.source) throw new BadRequestException('Record the official source of this holiday before activating it');
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockGuard.assertDateRangeNotLockedInTransaction(tx, before.startDate, before.endDate);
      return tx.publicHoliday.update({
        where: { id, status: CalendarPolicyStatus.DRAFT },
        data: { status: CalendarPolicyStatus.ACTIVE, approvalReference: dto.approvalReference, activatedByUserId: actorUserId, activatedAt: new Date() },
      });
    }, TX);
    await this.audit(actorUserId, context, 'PublicHoliday', id, 'PUBLIC_HOLIDAY_ACTIVATED', before, updated);
    return updated;
  }

  async deactivateHoliday(id: string, dto: DeactivateDto, actorUserId: string, context: RequestContext) {
    const before = await this.prisma.publicHoliday.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Public holiday not found');
    if (before.status === CalendarPolicyStatus.INACTIVE) throw new ConflictException('This holiday is already inactive');
    const updated = await this.prisma.$transaction(async (tx) => {
      if (before.status === CalendarPolicyStatus.ACTIVE) await this.lockGuard.assertDateRangeNotLockedInTransaction(tx, before.startDate, before.endDate);
      return tx.publicHoliday.update({
        where: { id },
        data: { status: CalendarPolicyStatus.INACTIVE, deactivatedByUserId: actorUserId, deactivatedAt: new Date(), deactivationReason: dto.reason },
      });
    }, TX);
    await this.audit(actorUserId, context, 'PublicHoliday', id, 'PUBLIC_HOLIDAY_DEACTIVATED', before, updated);
    return updated;
  }

  // ---------------------------------------------------------------- resolution views

  /** Resolves every day of `period` for a chunk of employees with fixed queries. */
  private async resolveChunk(
    tx: Tx,
    employees: { id: string; hireDate: Date; terminationDate: Date | null }[],
    period: MonthPeriod,
  ): Promise<Map<string, { date: string; resolution: CalendarDayResolution; shift: { id: string; name: string; startTimeMinutes: number; endTimeMinutes: number } | null }[]>> {
    const ids = employees.map((e) => e.id);
    const shiftAssignments = await tx.shiftAssignment.findMany({
      where: { employeeId: { in: ids }, effectiveFrom: { lt: period.rangeEndUtc }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.rangeStartUtc } }] },
      select: { id: true, employeeId: true, effectiveFrom: true, effectiveTo: true, shift: true },
    });
    const ctx = await loadCalendarContext(tx, ids, [...new Set(shiftAssignments.map((a) => a.shift.id))], period.periodStart, period.periodEnd);
    const byEmployee = new Map<string, AssignmentFact[]>();
    for (const a of shiftAssignments) {
      const list = byEmployee.get(a.employeeId) ?? [];
      list.push({ id: a.id, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo, shift: a.shift });
      byEmployee.set(a.employeeId, list);
    }
    const out = new Map<string, { date: string; resolution: CalendarDayResolution; shift: { id: string; name: string; startTimeMinutes: number; endTimeMinutes: number } | null }[]>();
    for (const e of employees) {
      const hire = dateOnly(e.hireDate);
      const term = e.terminationDate ? dateOnly(e.terminationDate) : null;
      out.set(
        e.id,
        period.dates.map((date) => {
          const { assignment, ambiguous } = selectAssignment(byEmployee.get(e.id) ?? [], date);
          const shift = assignment?.shift ?? null;
          const { durationMinutes, overnight } = shift ? shiftDuration(shift) : { durationMinutes: null, overnight: false };
          const resolution = resolveCalendarDay(ctx, {
            employeeId: e.id,
            date,
            employed: date >= hire && (term === null || date <= term),
            shift: shift ? { id: shift.id, overnight, durationMinutes } : null,
            shiftAmbiguous: ambiguous,
          });
          return { date, resolution, shift: shift ? { id: shift.id, name: shift.name, startTimeMinutes: shift.startTimeMinutes, endTimeMinutes: shift.endTimeMinutes } : null };
        }),
      );
    }
    return out;
  }

  private snapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return fn(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 60_000 },
    );
  }

  /** One employee's month, day by day, as payroll would see it. */
  async previewEmployee(employeeId: string, month: string) {
    const period = parseMonth(month);
    return this.snapshot(async (tx) => {
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, employeeCode: true, firstName: true, lastName: true, hireDate: true, terminationDate: true, workLocation: { select: { name: true } } },
      });
      if (!employee) throw new NotFoundException('Employee not found');
      const days = (await this.resolveChunk(tx, [employee], period)).get(employee.id) ?? [];
      return {
        employee: { id: employee.id, employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName}`.trim(), workLocation: employee.workLocation?.name ?? null },
        month,
        policyVersion: CALENDAR_RESOLVER_VERSION,
        leaveIntegration: LEAVE_INTEGRATION_AVAILABLE ? 'AVAILABLE' : 'NOT_AVAILABLE',
        days,
      };
    });
  }

  /** Company-wide coverage for a month: who has no approved calendar or a conflict. */
  async coverage(month: string) {
    const period = parseMonth(month);
    return this.snapshot(async (tx) => {
      const where = this.payrollAttendanceService.employeeWhere({}, period);
      const counts: Record<DayClassification, number> = { NOT_EMPLOYED: 0, SCHEDULED_WORKDAY: 0, REST_DAY: 0, PUBLIC_HOLIDAY: 0, APPROVED_LEAVE: 0, UNKNOWN: 0 };
      let employees = 0;
      let fullyCovered = 0;
      let withUnknown = 0;
      let withConflicts = 0;
      const sample: { employeeId: string; employeeCode: string; name: string; unknownDays: number; conflictDays: number; conflicts: string[] }[] = [];
      for (let skip = 0; ; skip += CHUNK) {
        const chunk = await tx.employee.findMany({
          where,
          select: { id: true, employeeCode: true, firstName: true, lastName: true, hireDate: true, terminationDate: true },
          orderBy: [{ employeeCode: 'asc' }, { id: 'asc' }],
          skip,
          take: CHUNK,
        });
        if (chunk.length === 0) break;
        const resolved = await this.resolveChunk(tx, chunk, period);
        for (const e of chunk) {
          employees += 1;
          const days = resolved.get(e.id) ?? [];
          let unknownDays = 0;
          let conflictDays = 0;
          const conflictCodes = new Set<string>();
          for (const d of days) {
            counts[d.resolution.classification] += 1;
            if (d.resolution.classification === 'UNKNOWN') unknownDays += 1;
            if (d.resolution.conflicts.length > 0) {
              conflictDays += 1;
              d.resolution.conflicts.forEach((c) => conflictCodes.add(c));
            }
          }
          if (unknownDays === 0) fullyCovered += 1;
          else withUnknown += 1;
          if (conflictDays > 0) withConflicts += 1;
          if (unknownDays > 0 && sample.length < SAMPLE_LIMIT) {
            sample.push({ employeeId: e.id, employeeCode: e.employeeCode, name: `${e.firstName} ${e.lastName}`.trim(), unknownDays, conflictDays, conflicts: [...conflictCodes].sort() });
          }
        }
        if (chunk.length < CHUNK) break;
      }
      return {
        month,
        policyVersion: CALENDAR_RESOLVER_VERSION,
        leaveIntegration: LEAVE_INTEGRATION_AVAILABLE ? 'AVAILABLE' : 'NOT_AVAILABLE',
        employees,
        fullyCoveredEmployees: fullyCovered,
        employeesWithUnknownDays: withUnknown,
        employeesWithConflicts: withConflicts,
        dayCounts: counts,
        sample,
        sampleTruncated: withUnknown > sample.length,
      };
    });
  }

  shiftOptions() {
    return this.prisma.shift.findMany({
      select: { id: true, name: true, code: true, startTimeMinutes: true, endTimeMinutes: true, isOvernight: true, isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }
}
