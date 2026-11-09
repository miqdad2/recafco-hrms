import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollAttendanceModule } from '../payroll-attendance/payroll-attendance.module';
import { PayrollLocksModule } from '../payroll-locks/payroll-locks.module';
import { PublicHolidaysController, WorkCalendarsController } from './work-calendars.controller';
import { WorkCalendarsService } from './work-calendars.service';

/** HR-POLICY-01 — working calendars, public holidays, day overrides, calendar assignments. */
@Module({
  imports: [AuthModule, PayrollLocksModule, PayrollAttendanceModule],
  controllers: [WorkCalendarsController, PublicHolidaysController],
  providers: [WorkCalendarsService],
})
export class WorkCalendarsModule {}
