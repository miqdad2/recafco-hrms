import { ConflictException, Injectable } from '@nestjs/common';
import { PayrollLockStatus, type AttendancePayrollLock } from '@recafco/db';
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
