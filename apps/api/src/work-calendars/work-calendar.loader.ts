import { CalendarPolicyStatus, type Prisma } from '@recafco/db';
import type { CalendarAssignmentFact, CalendarContext, CalendarFact, DayOverrideFact, HolidayFact } from './work-calendar.resolver';

type Tx = Prisma.TransactionClient;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

/**
 * HR-POLICY-01 — bulk-loads the ACTIVE calendar facts needed to resolve every day of
 * [periodStart, periodEnd] for a set of employees and their shifts, in a FIXED number of
 * queries (no N+1). DRAFT and INACTIVE rows are excluded here, so they can never apply.
 * A plain function (not a Nest provider) so both the Unit 20.2 report and the Unit 21.1
 * readiness evaluation can call it on their own transaction without a module cycle.
 */
export async function loadCalendarContext(
  tx: Tx,
  employeeIds: string[],
  shiftIds: string[],
  periodStart: string,
  periodEnd: string,
): Promise<CalendarContext> {
  const from = day(periodStart);
  const to = day(periodEnd);
  const targets: Prisma.WorkCalendarAssignmentWhereInput[] = [{ employeeId: { in: employeeIds } }];
  if (shiftIds.length > 0) targets.push({ shiftId: { in: shiftIds } });

  const [assignments, holidays] = await Promise.all([
    tx.workCalendarAssignment.findMany({
      where: {
        calendar: { status: CalendarPolicyStatus.ACTIVE },
        effectiveFrom: { lte: to },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, { OR: targets }],
      },
      select: { id: true, calendarId: true, scope: true, employeeId: true, shiftId: true, effectiveFrom: true, effectiveTo: true },
    }),
    tx.publicHoliday.findMany({
      where: { status: CalendarPolicyStatus.ACTIVE, startDate: { lte: to }, endDate: { gte: from } },
      select: { id: true, name: true, startDate: true, endDate: true },
    }),
  ]);

  const calendarIds = [...new Set(assignments.map((a) => a.calendarId))];
  const [calendars, overrides] = await Promise.all([
    calendarIds.length > 0
      ? tx.workCalendar.findMany({
          where: { id: { in: calendarIds }, status: CalendarPolicyStatus.ACTIVE },
          select: { id: true, code: true, name: true, workingWeekdays: true },
        })
      : Promise.resolve([]),
    tx.workCalendarDayOverride.findMany({
      where: {
        status: CalendarPolicyStatus.ACTIVE,
        date: { gte: from, lte: to },
        OR: [{ employeeId: { in: employeeIds } }, ...(calendarIds.length > 0 ? [{ calendarId: { in: calendarIds } }] : [])],
      },
      select: { id: true, calendarId: true, employeeId: true, date: true, dayType: true },
    }),
  ]);

  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  const ctx: CalendarContext = {
    calendarsById: new Map(calendars.map((c): [string, CalendarFact] => [c.id, c])),
    employeeAssignments: new Map(),
    shiftAssignments: new Map(),
    calendarOverrides: new Map(),
    employeeOverrides: new Map(),
    holidays: holidays.map((h): HolidayFact => ({ id: h.id, name: h.name, startDate: dateOnly(h.startDate), endDate: dateOnly(h.endDate) })),
  };
  for (const a of assignments) {
    const fact: CalendarAssignmentFact = {
      id: a.id,
      calendarId: a.calendarId,
      effectiveFrom: dateOnly(a.effectiveFrom),
      effectiveTo: a.effectiveTo ? dateOnly(a.effectiveTo) : null,
    };
    if (a.scope === 'EMPLOYEE' && a.employeeId) push(ctx.employeeAssignments, a.employeeId, fact);
    if (a.scope === 'SHIFT' && a.shiftId) push(ctx.shiftAssignments, a.shiftId, fact);
  }
  for (const o of overrides) {
    const fact: DayOverrideFact = { id: o.id, date: dateOnly(o.date), dayType: o.dayType };
    if (o.employeeId) push(ctx.employeeOverrides, o.employeeId, fact);
    if (o.calendarId) push(ctx.calendarOverrides, o.calendarId, fact);
  }
  return ctx;
}
