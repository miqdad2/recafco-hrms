import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  DailyAttendanceStatus,
  PunchType,
  PunchValidationStatus,
  type AttendanceDailySummary,
  type AttendanceRawPunch,
  type Prisma,
  type Shift,
} from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { PayrollLockGuardService } from '../payroll-locks/payroll-lock-guard.service';
import { RecalculateRangeDto } from './dto/recalculate-range.dto';
import { addShiftMinutesToWorkDate, kuwaitWorkDateRange, parseWorkDateInput, toKuwaitWorkDate } from './kuwait-date.util';

/** Only these statuses represent a punch trustworthy enough to become an official IN/OUT — everything else (rejected/pending/duplicate) is excluded. */
const ELIGIBLE_VALIDATION_STATUSES: PunchValidationStatus[] = [
  PunchValidationStatus.ACCEPTED,
  PunchValidationStatus.ACCEPTED_WITH_WARNING,
];

interface MinutesResult {
  totalWorkedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
}

interface RecalculateRangeResult {
  totalCandidateDays: number;
  calculated: number;
  skippedLocked: number;
  failed: number;
}

@Injectable()
export class AttendanceSummaryCalculatorService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly payrollLockGuardService: PayrollLockGuardService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async calculateForEmployeeDate(
    employeeId: string,
    workDateInput: string,
    actorUserId: string,
    context: RequestContext,
  ): Promise<AttendanceDailySummary> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      throw new BadRequestException('employeeId does not reference an existing employee');
    }

    const workDate = parseWorkDateInput(workDateInput);

    // Period-level check first: a date can be inside a LOCKED payroll period even when no
    // AttendanceDailySummary row exists yet — the per-summary `lockedAt` check below alone
    // would silently miss that case and let a brand-new summary be calculated for a locked date.
    await this.payrollLockGuardService.assertWorkDateNotLocked(workDate);

    const existing = await this.prisma.attendanceDailySummary.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
    });

    if (existing?.lockedAt) {
      throw new ConflictException('Cannot recalculate a locked attendance summary');
    }

    const eligiblePunches = await this.getEligiblePunches(employeeId, workDate);
    const { officialIn, officialOut } = this.chooseOfficialInOut(eligiblePunches);
    const shift = await this.findActiveShift(employeeId, workDate);
    const minutes = this.calculateMinutes(officialIn, officialOut, shift, workDate);
    const status = this.determineStatus(officialIn, officialOut, minutes.lateMinutes);

    const officialInPunchId = officialIn?.id ?? null;
    const officialOutPunchId = officialOut?.id ?? null;

    const summary = await this.prisma.$transaction(async (tx) => {
      await this.updateOfficialFlags(tx, employeeId, workDate, officialInPunchId, officialOutPunchId);
      return this.upsertDailySummary(tx, employeeId, workDate, existing, {
        officialInPunchId,
        officialOutPunchId,
        officialInTime: officialIn?.punchTimeSource ?? null,
        officialOutTime: officialOut?.punchTimeSource ?? null,
        ...minutes,
        status,
      });
    });

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendanceDailySummary',
      entityId: summary.id,
      action: existing ? 'ATTENDANCE_SUMMARY_RECALCULATED' : 'ATTENDANCE_SUMMARY_CALCULATED',
      beforeSnapshot: existing ? toJsonSnapshot(existing) : undefined,
      afterSnapshot: toJsonSnapshot(summary),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return summary;
  }

  async recalculateRange(
    dto: RecalculateRangeDto,
    actorUserId: string,
    context: RequestContext,
  ): Promise<RecalculateRangeResult> {
    const limit = dto.limit ?? 20;
    const fromDate = parseWorkDateInput(dto.from);
    const toDate = parseWorkDateInput(dto.to);
    const rangeStart = kuwaitWorkDateRange(fromDate).start;
    const rangeEnd = kuwaitWorkDateRange(toDate).end;

    const where: Prisma.AttendanceRawPunchWhereInput = {
      punchTimeSource: { gte: rangeStart, lt: rangeEnd },
    };
    if (dto.employeeId) {
      where.employeeId = dto.employeeId;
    }

    const rawPunches = await this.prisma.attendanceRawPunch.findMany({
      where,
      select: { employeeId: true, punchTimeSource: true },
    });

    const candidatesByKey = new Map<string, { employeeId: string; workDate: Date }>();
    for (const punch of rawPunches) {
      const workDate = toKuwaitWorkDate(punch.punchTimeSource);
      const key = `${punch.employeeId}|${workDate.toISOString()}`;
      if (!candidatesByKey.has(key)) {
        candidatesByKey.set(key, { employeeId: punch.employeeId, workDate });
      }
    }

    const candidates = Array.from(candidatesByKey.values())
      .sort((a, b) => a.workDate.getTime() - b.workDate.getTime() || a.employeeId.localeCompare(b.employeeId))
      .slice(0, limit);

    const result: RecalculateRangeResult = {
      totalCandidateDays: candidates.length,
      calculated: 0,
      skippedLocked: 0,
      failed: 0,
    };

    for (const candidate of candidates) {
      try {
        await this.calculateForEmployeeDate(candidate.employeeId, candidate.workDate.toISOString(), actorUserId, context);
        result.calculated += 1;
      } catch (error) {
        if (error instanceof ConflictException) {
          result.skippedLocked += 1;
        } else {
          result.failed += 1;
        }
      }
    }

    return result;
  }

  private async getEligiblePunches(employeeId: string, workDate: Date): Promise<AttendanceRawPunch[]> {
    const { start, end } = kuwaitWorkDateRange(workDate);
    return this.prisma.attendanceRawPunch.findMany({
      where: {
        employeeId,
        punchTimeSource: { gte: start, lt: end },
        validationStatus: { in: ELIGIBLE_VALIDATION_STATUSES },
      },
      orderBy: { punchTimeSource: 'asc' },
    });
  }

  private chooseOfficialInOut(punches: AttendanceRawPunch[]): {
    officialIn: AttendanceRawPunch | null;
    officialOut: AttendanceRawPunch | null;
  } {
    const ins = punches.filter((p) => p.punchType === PunchType.IN);
    const outs = punches.filter((p) => p.punchType === PunchType.OUT);
    return {
      officialIn: ins[0] ?? null,
      officialOut: outs.length > 0 ? (outs[outs.length - 1] ?? null) : null,
    };
  }

  private async findActiveShift(employeeId: string, workDate: Date): Promise<Shift | null> {
    const { start, end } = kuwaitWorkDateRange(workDate);
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: {
        employeeId,
        effectiveFrom: { lt: end },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      include: { shift: true },
    });
    return assignment?.shift ?? null;
  }

  private calculateMinutes(
    officialIn: AttendanceRawPunch | null,
    officialOut: AttendanceRawPunch | null,
    shift: Shift | null,
    workDate: Date,
  ): MinutesResult {
    if (!officialIn || !officialOut) {
      return { totalWorkedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 };
    }

    const totalWorkedMinutes = Math.max(
      0,
      Math.round((officialOut.punchTimeSource.getTime() - officialIn.punchTimeSource.getTime()) / 60_000),
    );

    if (!shift) {
      return { totalWorkedMinutes, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 };
    }

    const shiftStart = addShiftMinutesToWorkDate(workDate, shift.startTimeMinutes);
    const shiftEndMinutes =
      shift.isOvernight || shift.endTimeMinutes <= shift.startTimeMinutes
        ? shift.endTimeMinutes + 24 * 60
        : shift.endTimeMinutes;
    const shiftEnd = addShiftMinutesToWorkDate(workDate, shiftEndMinutes);

    const lateMinutes = Math.max(0, Math.round((officialIn.punchTimeSource.getTime() - shiftStart.getTime()) / 60_000));
    const earlyLeaveMinutes = Math.max(
      0,
      Math.round((shiftEnd.getTime() - officialOut.punchTimeSource.getTime()) / 60_000),
    );
    const overtimeMinutes = Math.max(
      0,
      Math.round((officialOut.punchTimeSource.getTime() - shiftEnd.getTime()) / 60_000),
    );

    return { totalWorkedMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes };
  }

  private determineStatus(
    officialIn: AttendanceRawPunch | null,
    officialOut: AttendanceRawPunch | null,
    lateMinutes: number,
  ): DailyAttendanceStatus {
    if (officialIn && officialOut) {
      return lateMinutes > 0 ? DailyAttendanceStatus.LATE : DailyAttendanceStatus.PRESENT;
    }
    if (officialIn || officialOut) {
      return DailyAttendanceStatus.MISSING_PUNCH;
    }
    return DailyAttendanceStatus.ABSENT;
  }

  private async updateOfficialFlags(
    tx: Prisma.TransactionClient,
    employeeId: string,
    workDate: Date,
    officialInPunchId: string | null,
    officialOutPunchId: string | null,
  ): Promise<void> {
    const { start, end } = kuwaitWorkDateRange(workDate);
    const keepIds = [officialInPunchId, officialOutPunchId].filter((id): id is string => id !== null);

    await tx.attendanceRawPunch.updateMany({
      where: {
        employeeId,
        punchTimeSource: { gte: start, lt: end },
        isOfficial: true,
        id: { notIn: keepIds },
      },
      data: { isOfficial: false },
    });

    for (const id of keepIds) {
      await tx.attendanceRawPunch.update({ where: { id }, data: { isOfficial: true } });
    }
  }

  private async upsertDailySummary(
    tx: Prisma.TransactionClient,
    employeeId: string,
    workDate: Date,
    existing: AttendanceDailySummary | null,
    computed: {
      officialInPunchId: string | null;
      officialOutPunchId: string | null;
      officialInTime: Date | null;
      officialOutTime: Date | null;
      totalWorkedMinutes: number;
      lateMinutes: number;
      earlyLeaveMinutes: number;
      overtimeMinutes: number;
      status: DailyAttendanceStatus;
    },
  ): Promise<AttendanceDailySummary> {
    const data: Prisma.AttendanceDailySummaryUncheckedCreateInput = {
      employeeId,
      workDate,
      officialInPunchId: computed.officialInPunchId,
      officialOutPunchId: computed.officialOutPunchId,
      officialInTime: computed.officialInTime,
      officialOutTime: computed.officialOutTime,
      totalWorkedMinutes: computed.totalWorkedMinutes,
      lateMinutes: computed.lateMinutes,
      earlyLeaveMinutes: computed.earlyLeaveMinutes,
      overtimeMinutes: computed.overtimeMinutes,
      status: computed.status,
      calculationVersion: (existing?.calculationVersion ?? 0) + 1,
      calculatedAt: new Date(),
    };

    return tx.attendanceDailySummary.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      create: data,
      update: data,
    });
  }
}
