import { Module } from '@nestjs/common';
import { AttendanceSummariesModule } from '../attendance-summaries/attendance-summaries.module';
import { AuthModule } from '../auth/auth.module';
import { PayrollLocksModule } from '../payroll-locks/payroll-locks.module';
import { AttendanceCorrectionsController } from './attendance-corrections.controller';
import { AttendanceCorrectionsService } from './attendance-corrections.service';

@Module({
  imports: [AuthModule, AttendanceSummariesModule, PayrollLocksModule],
  controllers: [AttendanceCorrectionsController],
  providers: [AttendanceCorrectionsService],
})
export class AttendanceCorrectionsModule {}
