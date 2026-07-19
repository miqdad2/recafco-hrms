import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollLockGuardService } from './payroll-lock-guard.service';
import { PayrollLocksController } from './payroll-locks.controller';
import { PayrollLocksService } from './payroll-locks.service';

@Module({
  imports: [AuthModule],
  controllers: [PayrollLocksController],
  providers: [PayrollLocksService, PayrollLockGuardService],
  exports: [PayrollLockGuardService],
})
export class PayrollLocksModule {}
