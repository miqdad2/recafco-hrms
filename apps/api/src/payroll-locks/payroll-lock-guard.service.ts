import { ConflictException, Injectable } from '@nestjs/common';
import { PayrollLockStatus, Prisma, type AttendancePayrollLock } from '@recafco/db';
import { DatabaseService } from '../database/database.service';

/**
 * Central guard for payroll-lock enforcement, shared by the summary calculator, the
 * corrections approval flow, and the payroll-locks module itself. A date is "locked" only
 * once its covering period has actually transitioned to LOCKED — a merely-created OPEN
 * period does not freeze anything yet.
 */
@Injectable()
export class PayrollLockGuardService {
  constructor(private readonly databaseService: DatabaseService) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async findActiveLockForDate(workDate: Date): Promise<AttendancePayrollLock | null> {
    return this.prisma.attendancePayrollLock.findFirst({
      where: {
        status: PayrollLockStatus.LOCKED,
        periodStart: { lte: workDate },
        periodEnd: { gte: workDate },
      },
    });
  }

  async isDateInLockedPeriod(workDate: Date): Promise<boolean> {
    return (await this.findActiveLockForDate(workDate)) !== null;
  }

  /** Blocks even when no AttendanceDailySummary row exists yet for workDate — the period-level lock is authoritative on its own. */
  async assertWorkDateNotLocked(workDate: Date): Promise<void> {
    const lock = await this.findActiveLockForDate(workDate);
    if (lock) {
      throw new ConflictException('This date falls inside a locked payroll period and cannot be modified');
    }
  }

  /**
   * Transaction-scoped variant (TIME-01). Takes `FOR SHARE` row locks on every payroll-lock row
   * covering `workDate`, then decides from the locked (latest committed) rows. Paired with
   * `PayrollLocksService.lockPeriod`, which takes `FOR UPDATE` on its period row as the first
   * statement of its transaction: the two serialise on that row, so a period cannot become LOCKED
   * between this check and the caller's summary write. Both sides lock the period row before any
   * summary row, so there is no lock-order deadlock between them.
   */
  async assertWorkDateNotLockedInTransaction(tx: Prisma.TransactionClient, workDate: Date): Promise<void> {
    const covering = await tx.attendancePayrollLock.findMany({
      where: { periodStart: { lte: workDate }, periodEnd: { gte: workDate } },
      select: { id: true },
    });
    if (covering.length === 0) {
      return;
    }
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM attendance_payroll_locks
      WHERE id IN (${Prisma.join(covering.map((lock) => lock.id))})
      FOR SHARE`;
    if (rows.some((row) => row.status === PayrollLockStatus.LOCKED)) {
      throw new ConflictException('This date falls inside a locked payroll period and cannot be modified');
    }
  }

  /**
   * HR-POLICY-01 — range variant of assertWorkDateNotLockedInTransaction, used by every
   * working-calendar change that alters how dates are classified (assignment create/end,
   * holiday and day-override activation/deactivation). Takes FOR SHARE on every payroll-lock row
   * overlapping [start, end] (end = null means open-ended), then refuses if any is LOCKED.
   * Serialises with lockPeriod's FOR UPDATE exactly like summary recalculation: a calendar change
   * either commits before the lock's readiness evaluation (and is evaluated) or waits and is
   * refused. Locked periods can therefore never be re-classified silently.
   */
  async assertDateRangeNotLockedInTransaction(tx: Prisma.TransactionClient, start: Date, end: Date | null): Promise<void> {
    const covering = await tx.attendancePayrollLock.findMany({
      where: { periodEnd: { gte: start }, ...(end ? { periodStart: { lte: end } } : {}) },
      select: { id: true },
    });
    if (covering.length === 0) {
      return;
    }
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM attendance_payroll_locks
      WHERE id IN (${Prisma.join(covering.map((lock) => lock.id))})
      ORDER BY id
      FOR SHARE`;
    if (rows.some((row) => row.status === PayrollLockStatus.LOCKED)) {
      throw new ConflictException(
        'This change would affect dates inside a locked payroll period. Unlock the period first (with a reason), or choose dates outside it.',
      );
    }
  }

  async assertDateRangeNotOverlappingActiveLock(
    periodStart: Date,
    periodEnd: Date,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.attendancePayrollLock.findFirst({
      where: {
        status: { in: [PayrollLockStatus.OPEN, PayrollLockStatus.LOCKED] },
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (overlapping) {
      throw new ConflictException('This date range overlaps an existing active payroll lock period');
    }
  }
}
