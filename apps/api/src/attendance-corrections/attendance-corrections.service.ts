import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceSourceType,
  CorrectionStatus,
  CorrectionType,
  EmployeeStatus,
  PunchType,
  PunchValidationStatus,
  type AttendanceCorrection,
  type AttendanceRawPunch,
  type Prisma,
} from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { AttendanceSummaryCalculatorService } from '../attendance-summaries/attendance-summary-calculator.service';
import { kuwaitWorkDateRange, parseWorkDateInput, toKuwaitWorkDate } from '../attendance-summaries/kuwait-date.util';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { resolveEmployeeIdForUser } from '../common/current-employee.util';
import { dateRangeFilter } from '../common/date-range.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { PayrollLockGuardService } from '../payroll-locks/payroll-lock-guard.service';
import { AdminRequestCorrectionDto } from './dto/admin-request-correction.dto';
import { ListAttendanceCorrectionsQueryDto } from './dto/list-attendance-corrections.query.dto';
import { ListMyAttendanceCorrectionsQueryDto } from './dto/list-my-attendance-corrections.query.dto';
import { RejectCorrectionDto } from './dto/reject-correction.dto';
import { RequestCorrectionDto } from './dto/request-correction.dto';

const RELATIONS_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
  requestedBy: { select: { id: true, username: true } },
  approvedBy: { select: { id: true, username: true } },
  targetPunch: { select: { id: true, punchType: true, punchTimeSource: true, sourceType: true } },
} satisfies Prisma.AttendanceCorrectionInclude;

/** MISSED_IN/MISSED_OUT/WRONG_IN/WRONG_OUT always imply their own punch type — the client is never asked (or trusted) for it. */
const PUNCH_TYPE_BY_CORRECTION_TYPE: Partial<Record<CorrectionType, PunchType>> = {
  [CorrectionType.MISSED_IN]: PunchType.IN,
  [CorrectionType.MISSED_OUT]: PunchType.OUT,
  [CorrectionType.WRONG_IN]: PunchType.IN,
  [CorrectionType.WRONG_OUT]: PunchType.OUT,
};

@Injectable()
export class AttendanceCorrectionsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly attendanceSummaryCalculatorService: AttendanceSummaryCalculatorService,
    private readonly payrollLockGuardService: PayrollLockGuardService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async findAll(query: ListAttendanceCorrectionsQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.AttendanceCorrectionWhereInput = {};
    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.correctionType) {
      where.correctionType = query.correctionType;
    }
    const workDate = dateRangeFilter(query.from, query.to);
    if (workDate) {
      where.workDate = workDate;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceCorrection.findMany({
        where,
        include: RELATIONS_INCLUDE,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.attendanceCorrection.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const correction = await this.prisma.attendanceCorrection.findUnique({ where: { id }, include: RELATIONS_INCLUDE });
    if (!correction) {
      throw new NotFoundException('Attendance correction not found');
    }
    return correction;
  }

  async findMine(userId: string, query: ListMyAttendanceCorrectionsQueryDto): Promise<PaginatedResult<unknown>> {
    const employeeId = await resolveEmployeeIdForUser(this.prisma, userId);

    const where: Prisma.AttendanceCorrectionWhereInput = { employeeId };
    if (query.status) {
      where.status = query.status;
    }
    const workDate = dateRangeFilter(query.from, query.to);
    if (workDate) {
      where.workDate = workDate;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceCorrection.findMany({
        where,
        include: RELATIONS_INCLUDE,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.attendanceCorrection.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async requestForSelf(dto: RequestCorrectionDto, userId: string, context: RequestContext): Promise<AttendanceCorrection> {
    const employeeId = await resolveEmployeeIdForUser(this.prisma, userId);
    return this.createCorrection(dto, employeeId, userId, context);
  }

  async requestForEmployee(
    dto: AdminRequestCorrectionDto,
    actorUserId: string,
    context: RequestContext,
  ): Promise<AttendanceCorrection> {
    return this.createCorrection(dto, dto.employeeId, actorUserId, context);
  }

  private async createCorrection(
    dto: RequestCorrectionDto,
    employeeId: string,
    actorUserId: string,
    context: RequestContext,
  ): Promise<AttendanceCorrection> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      throw new BadRequestException('employeeId does not reference an existing employee');
    }
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Attendance corrections can only be requested for active employees');
    }

    const workDate = parseWorkDateInput(dto.workDate);
    const isOther = dto.correctionType === CorrectionType.OTHER;

    let requestedPunchTime: Date | null = null;
    if (!isOther && dto.requestedPunchTime) {
      requestedPunchTime = new Date(dto.requestedPunchTime);
      if (toKuwaitWorkDate(requestedPunchTime).getTime() !== workDate.getTime()) {
        throw new BadRequestException('requestedPunchTime must fall on the same Kuwait calendar day as workDate');
      }
    }

    const requestedPunchType = isOther
      ? null
      : (PUNCH_TYPE_BY_CORRECTION_TYPE[dto.correctionType] ?? dto.requestedPunchType ?? null);

    if (dto.targetPunchId) {
      const targetPunch = await this.prisma.attendanceRawPunch.findUnique({ where: { id: dto.targetPunchId } });
      if (!targetPunch || targetPunch.employeeId !== employeeId) {
        throw new BadRequestException('targetPunchId does not reference an existing punch for this employee');
      }
      if (toKuwaitWorkDate(targetPunch.punchTimeSource).getTime() !== workDate.getTime()) {
        throw new BadRequestException('targetPunchId does not belong to the requested workDate');
      }
    }

    const { start, end } = kuwaitWorkDateRange(workDate);
    const [existingSummary, dayPunches] = await Promise.all([
      this.prisma.attendanceDailySummary.findUnique({ where: { employeeId_workDate: { employeeId, workDate } } }),
      this.prisma.attendanceRawPunch.findMany({
        where: { employeeId, punchTimeSource: { gte: start, lt: end } },
        orderBy: { punchTimeSource: 'asc' },
      }),
    ]);

    const data: Prisma.AttendanceCorrectionUncheckedCreateInput = {
      employeeId,
      workDate,
      requestedByUserId: actorUserId,
      reason: dto.reason,
      status: CorrectionStatus.PENDING,
      correctionType: dto.correctionType,
      requestedPunchType,
      requestedPunchTime,
      targetPunchId: dto.targetPunchId ?? null,
      beforeSnapshot: toJsonSnapshot({ summary: existingSummary ?? null, rawPunches: dayPunches }),
      afterSnapshot: toJsonSnapshot({
        correctionType: dto.correctionType,
        requestedPunchType,
        requestedPunchTime,
        targetPunchId: dto.targetPunchId ?? null,
        reason: dto.reason,
      }),
    };

    const correction = await this.prisma.attendanceCorrection.create({ data });

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendanceCorrection',
      entityId: correction.id,
      action: 'ATTENDANCE_CORRECTION_REQUESTED',
      afterSnapshot: toJsonSnapshot(correction),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return correction;
  }

  async approveCorrection(id: string, actorUserId: string, context: RequestContext) {
    const correction = await this.prisma.attendanceCorrection.findUnique({ where: { id } });
    if (!correction) {
      throw new NotFoundException('Attendance correction not found');
    }
    if (correction.status !== CorrectionStatus.PENDING) {
      throw new ConflictException('Only pending corrections can be approved');
    }

    // Period-level check first: a correction's workDate can fall inside a LOCKED payroll
    // period even when no AttendanceDailySummary row exists yet for that employee/date — the
    // per-summary `lockedAt` check below alone would miss that case entirely.
    await this.payrollLockGuardService.assertWorkDateNotLocked(correction.workDate);

    const existingSummary = await this.prisma.attendanceDailySummary.findUnique({
      where: { employeeId_workDate: { employeeId: correction.employeeId, workDate: correction.workDate } },
    });
    if (existingSummary?.lockedAt) {
      throw new ConflictException('Cannot approve a correction for a locked attendance summary');
    }

    const requiresManualPunch =
      correction.correctionType !== CorrectionType.OTHER &&
      correction.requestedPunchType !== null &&
      correction.requestedPunchTime !== null;

    const { updatedCorrection, manualPunch } = await this.prisma.$transaction(async (tx) => {
      // Unit 21.1: re-check the period lock INSIDE the write transaction under FOR SHARE on the
      // covering period row(s). Previously the only check ran before this transaction, so a
      // period could become LOCKED in between and the correction would still be approved (with
      // its manual punch) inside a locked period. PayrollLocksService.lockPeriod takes FOR UPDATE
      // on the same row, so the two now serialise: either this commits first (and the lock's
      // readiness check sees the approved correction and the not-yet-recalculated day), or the
      // lock commits first and this refuses with 409.
      await this.payrollLockGuardService.assertWorkDateNotLockedInTransaction(tx, correction.workDate);

      let createdPunch: AttendanceRawPunch | null = null;
      if (requiresManualPunch) {
        const punchData: Prisma.AttendanceRawPunchUncheckedCreateInput = {
          employeeId: correction.employeeId,
          punchType: correction.requestedPunchType as PunchType,
          sourceType: AttendanceSourceType.MANUAL_CORRECTION,
          punchTimeSource: correction.requestedPunchTime as Date,
          punchTimeServer: new Date(),
          validationStatus: PunchValidationStatus.ACCEPTED_WITH_WARNING,
          fraudScore: 0,
          fraudFlags: toJsonSnapshot([]),
          rawPayload: toJsonSnapshot({
            correctionId: correction.id,
            reason: correction.reason,
            approvedByUserId: actorUserId,
            targetPunchId: correction.targetPunchId,
          }),
          isOfficial: false,
        };
        createdPunch = await tx.attendanceRawPunch.create({ data: punchData });
      }

      const updated = await tx.attendanceCorrection.update({
        where: { id },
        data: {
          status: CorrectionStatus.APPROVED,
          approvedByUserId: actorUserId,
          approvedAt: new Date(),
        },
      });

      return { updatedCorrection: updated, manualPunch: createdPunch };
    });

    if (manualPunch) {
      await this.auditService.record({
        actorUserId,
        entityType: 'AttendanceRawPunch',
        entityId: manualPunch.id,
        action: 'ATTENDANCE_CORRECTION_MANUAL_PUNCH_CREATED',
        afterSnapshot: toJsonSnapshot(manualPunch),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendanceCorrection',
      entityId: id,
      action: 'ATTENDANCE_CORRECTION_APPROVED',
      beforeSnapshot: toJsonSnapshot(correction),
      afterSnapshot: toJsonSnapshot(updatedCorrection),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    // Recalculating through the one shared calculator (not a duplicated inline selection) is what lets
    // a newly-created manual punch become an official IN/OUT via the normal summary-selection rules.
    let summary = existingSummary;
    if (manualPunch) {
      summary = await this.attendanceSummaryCalculatorService.calculateForEmployeeDate(
        correction.employeeId,
        correction.workDate.toISOString(),
        actorUserId,
        context,
      );
    }

    return { ...updatedCorrection, manualPunchId: manualPunch?.id ?? null, summaryId: summary?.id ?? null };
  }

  async rejectCorrection(id: string, dto: RejectCorrectionDto, actorUserId: string, context: RequestContext) {
    const correction = await this.prisma.attendanceCorrection.findUnique({ where: { id } });
    if (!correction) {
      throw new NotFoundException('Attendance correction not found');
    }
    if (correction.status !== CorrectionStatus.PENDING) {
      throw new ConflictException('Only pending corrections can be rejected');
    }

    const updated = await this.prisma.attendanceCorrection.update({
      where: { id },
      data: {
        status: CorrectionStatus.REJECTED,
        rejectedReason: dto.rejectedReason,
        rejectedAt: new Date(),
      },
    });

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendanceCorrection',
      entityId: id,
      action: 'ATTENDANCE_CORRECTION_REJECTED',
      beforeSnapshot: toJsonSnapshot(correction),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }
}
