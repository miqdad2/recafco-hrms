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
import type { PayrollClosingReadiness } from './payroll-closing-readiness.rules';
import { PayrollClosingReadinessService } from './payroll-closing-readiness.service';

export interface PayrollLockActionResult {
  lock: AttendancePayrollLock;
  affectedSummaryCount: number;
}

/** Readiness over 2,000 employees takes seconds; the default 5 s interactive timeout is too short. */
const LOCK_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

/** Internal signal used to roll the lock transaction back when readiness fails. */
class PeriodNotReadyError extends Error {
  constructor(readonly readiness: PayrollClosingReadiness) {
    super(PAYROLL_PERIOD_NOT_READY);
  }
}

export const PAYROLL_PERIOD_NOT_READY = 'PAYROLL_PERIOD_NOT_READY';

function notReadyConflict(readiness: PayrollClosingReadiness): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: PAYROLL_PERIOD_NOT_READY,
    message: `This payroll period cannot be locked: ${readiness.blockingIssueCount} blocking attendance issue(s) must be resolved first.`,
    reasonCodes: Object.entries(readiness.issuesByType)
      .filter(([, info]) => info?.severity === 'BLOCKING')
      .map(([code]) => code),
    readiness,
  });
}

/** Compact readiness facts for audit snapshots (no employee-level detail). */
function readinessAuditSummary(readiness: PayrollClosingReadiness) {
  return {
    rulesVersion: readiness.rulesVersion,
    ready: readiness.ready,
    evaluatedAt: readiness.evaluatedAt,
    employeesEvaluated: readiness.employeesEvaluated,
    employeeDaysEvaluated: readiness.employeeDaysEvaluated,
    blockingIssueCount: readiness.blockingIssueCount,
    warningCount: readiness.warningCount,
    issuesByType: readiness.issuesByType,
  };
}

@Injectable()
export class PayrollLocksService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly payrollLockGuardService: PayrollLockGuardService,
    private readonly payrollClosingReadinessService: PayrollClosingReadinessService,
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

    let transactionResult: { affectedSummaryCount: number; lock: AttendancePayrollLock; readiness: PayrollClosingReadiness };
    try {
      transactionResult = await this.prisma.$transaction(async (tx) => {
        // TIME-01: lock the period row FIRST. In-flight summary recalculations and correction
        // approvals hold FOR SHARE on this row (PayrollLockGuardService.assertWorkDateNotLocked-
        // InTransaction), so this waits for them to commit — their results are then visible to the
        // readiness evaluation below — and any that start afterwards block until this transaction
        // ends, then see LOCKED and refuse to write.
        const [lockedRow] = await tx.$queryRaw<{ status: string }[]>`
          SELECT status::text AS status FROM attendance_payroll_locks WHERE id = ${id} FOR UPDATE`;
        if (lockedRow?.status !== PayrollLockStatus.OPEN && lockedRow?.status !== PayrollLockStatus.REOPENED) {
          throw new ConflictException('Only an open or reopened payroll period can be locked');
        }

        // Unit 21.1: readiness is evaluated in THIS transaction (READ COMMITTED, every statement
        // after the FOR UPDATE above), so the decision and the LOCKED transition commit together.
        // There is no override, bypass parameter or privileged role — SUPER_ADMIN included.
        const readiness = await this.payrollClosingReadinessService.evaluate(tx, {
          id,
          status: lockedRow.status as PayrollLockStatus,
          periodStart: existing.periodStart,
          periodEnd: existing.periodEnd,
        });
        if (!readiness.ready) {
          throw new PeriodNotReadyError(readiness);
        }

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
        return { affectedSummaryCount: updateResult.count, lock: updatedLock, readiness };
      }, LOCK_TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof PeriodNotReadyError) {
        // The transaction rolled back: nothing was locked. Record the refused attempt.
        await this.recordRefusal(existing, error.readiness, actorUserId, context);
        throw notReadyConflict(error.readiness);
      }
      throw error;
    }
    const { affectedSummaryCount, lock, readiness } = transactionResult;

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendancePayrollLock',
      entityId: id,
      action: 'PAYROLL_PERIOD_LOCKED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot({ ...lock, affectedSummaryCount, readiness: readinessAuditSummary(readiness) }),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { lock, affectedSummaryCount };
  }

  /** Readiness for the readiness endpoint (read-only snapshot). */
  readiness(id: string): Promise<PayrollClosingReadiness> {
    return this.payrollClosingReadinessService.evaluateById(id);
  }

  private async recordRefusal(
    existing: AttendancePayrollLock,
    readiness: PayrollClosingReadiness,
    actorUserId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.auditService.record({
      actorUserId,
      entityType: 'AttendancePayrollLock',
      entityId: existing.id,
      action: 'PAYROLL_PERIOD_LOCK_REFUSED_NOT_READY',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(readinessAuditSummary(readiness)),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
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
