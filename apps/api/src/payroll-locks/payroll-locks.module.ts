import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollAttendanceModule } from '../payroll-attendance/payroll-attendance.module';
import { PayrollClosingReadinessService } from './payroll-closing-readiness.service';
import { PayrollLockGuardService } from './payroll-lock-guard.service';
import { PayrollLocksController } from './payroll-locks.controller';
import { PayrollLocksService } from './payroll-locks.service';

@Module({
  imports: [AuthModule, PayrollAttendanceModule],
  controllers: [PayrollLocksController],
  providers: [PayrollLocksService, PayrollLockGuardService, PayrollClosingReadinessService],
  exports: [PayrollLockGuardService],
})
export class PayrollLocksModule {}
