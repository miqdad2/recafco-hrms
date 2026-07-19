import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollLocksModule } from '../payroll-locks/payroll-locks.module';
import { AttendanceSummariesController } from './attendance-summaries.controller';
import { AttendanceSummariesService } from './attendance-summaries.service';
import { AttendanceSummaryCalculatorService } from './attendance-summary-calculator.service';

@Module({
  imports: [AuthModule, PayrollLocksModule],
  controllers: [AttendanceSummariesController],
  providers: [AttendanceSummariesService, AttendanceSummaryCalculatorService],
  exports: [AttendanceSummaryCalculatorService],
})
export class AttendanceSummariesModule {}
