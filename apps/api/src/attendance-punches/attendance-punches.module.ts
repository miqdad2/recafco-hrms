import { Module } from '@nestjs/common';
import { AttendanceSummariesModule } from '../attendance-summaries/attendance-summaries.module';
import { AuthModule } from '../auth/auth.module';
import { ClockService } from '../common/clock.service';
import { PayrollLocksModule } from '../payroll-locks/payroll-locks.module';
import { AttendancePunchesController } from './attendance-punches.controller';
import { AttendancePunchesService } from './attendance-punches.service';
import { AttendanceValidationService } from './attendance-validation.service';

@Module({
  imports: [AuthModule, AttendanceSummariesModule, PayrollLocksModule],
  controllers: [AttendancePunchesController],
  providers: [AttendancePunchesService, AttendanceValidationService, ClockService],
})
export class AttendancePunchesModule {}
