import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollLockStatus, type AttendancePayrollLock, type Prisma } from '@recafco/db';
import { parseWorkDateInput } from '../attendance-summaries/kuwait-date.util';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { CreatePayrollLockDto } from './dto/create-payroll-lock.dto';
import { ListPayrollLocksQueryDto } from './dto/list-payroll-locks.query.dto';
import { UnlockPayrollLockDto } from './dto/unlock-payroll-lock.dto';
import { PayrollLockGuardService } from './payroll-lock-guard.service';

export interface PayrollLockActionResult {
  lock: AttendancePayrollLock;
  affectedSummaryCount: number;
}

@Injectable()
export class PayrollLocksService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly payrollLockGuardService: PayrollLockGuardService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async findAll(query: ListPayrollLocksQueryDto): Promise<PaginatedResult<AttendancePayrollLock>> {
    const where: Prisma.AttendancePayrollLockWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.from) {
      where.periodEnd = { gte: parseWorkDateInput(query.from) };
    }
    if (query.to) {
      where.periodStart = { lte: parseWorkDateInput(query.to) };
    }

    const [data, total] = await Promise.all([
      this.prisma.attendancePayrollLock.findMany({
        where,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.attendancePayrollLock.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<AttendancePayrollLock> {
    const lock = await this.prisma.attendancePayrollLock.findUnique({ where: { id } });
    if (!lock) {
      throw new NotFoundException('Payroll lock period not found');
    }
    return lock;
  }

  async create(
    dto: CreatePayrollLockDto,
    actorUserId: string,
    context: RequestContext,
  ): Promise<AttendancePayrollLock> {
    const periodStart = parseWorkDateInput(dto.periodStart);
    const periodEnd = parseWorkDateInput(dto.periodEnd);

    if (periodStart.getTime() > periodEnd.getTime()) {
      throw new BadRequestException('periodStart must be on or before periodEnd');
    }

    await this.payrollLockGuardService.assertDateRangeNotOverlappingActiveLock(periodStart, periodEnd);

    const data: Prisma.AttendancePayrollLockUncheckedCreateInput = {
      periodStart,
      periodEnd,
      status: PayrollLockStatus.OPEN,
      reason: dto.reason ?? null,
      notes: dto.notes ?? null,
      createdByUserId: actorUserId,
    };

    const lock = await this.prisma.attendancePayrollLock.create({ data });

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendancePayrollLock',
      entityId: lock.id,
      action: 'PAYROLL_LOCK_CREATED',
      afterSnapshot: toJsonSnapshot(lock),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return lock;
  }

  async lockPeriod(id: string, actorUserId: string, context: RequestContext): Promise<PayrollLockActionResult> {
    const existing = await this.findOne(id);

    if (existing.status !== PayrollLockStatus.OPEN && existing.status !== PayrollLockStatus.REOPENED) {
      throw new ConflictException('Only an open or reopened payroll period can be locked');
    }

    await this.payrollLockGuardService.assertDateRangeNotOverlappingActiveLock(
      existing.periodStart,
      existing.periodEnd,
      existing.id,
    );

    const now = new Date();

    const { affectedSummaryCount, lock } = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.attendanceDailySummary.updateMany({
        where: { workDate: { gte: existing.periodStart, lte: existing.periodEnd }, lockedAt: null },
        data: { lockedAt: now },
      });
      const totalInRange = await tx.attendanceDailySummary.count({
        where: { workDate: { gte: existing.periodStart, lte: existing.periodEnd } },
      });
      const updatedLock = await tx.attendancePayrollLock.update({
        where: { id },
        data: {
          status: PayrollLockStatus.LOCKED,
          lockedByUserId: actorUserId,
          lockedAt: now,
          summaryCount: totalInRange,
        },
      });
      return { affectedSummaryCount: updateResult.count, lock: updatedLock };
    });

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendancePayrollLock',
      entityId: id,
      action: 'PAYROLL_PERIOD_LOCKED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot({ ...lock, affectedSummaryCount }),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { lock, affectedSummaryCount };
  }

  async unlockPeriod(
    id: string,
    dto: UnlockPayrollLockDto,
    actorUserId: string,
    context: RequestContext,
  ): Promise<PayrollLockActionResult> {
    const existing = await this.findOne(id);

    if (existing.status !== PayrollLockStatus.LOCKED) {
      throw new ConflictException('Only a locked payroll period can be unlocked');
    }

    const now = new Date();

    const { affectedSummaryCount, lock } = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.attendanceDailySummary.updateMany({
        where: { workDate: { gte: existing.periodStart, lte: existing.periodEnd }, lockedAt: { not: null } },
        data: { lockedAt: null },
      });
      const updatedLock = await tx.attendancePayrollLock.update({
        where: { id },
        data: {
          status: PayrollLockStatus.REOPENED,
          reopenedByUserId: actorUserId,
          reopenedAt: now,
          reopenReason: dto.reason,
        },
      });
      return { affectedSummaryCount: updateResult.count, lock: updatedLock };
    });

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendancePayrollLock',
      entityId: id,
      action: 'PAYROLL_PERIOD_UNLOCKED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot({ ...lock, affectedSummaryCount }),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { lock, affectedSummaryCount };
  }
}
