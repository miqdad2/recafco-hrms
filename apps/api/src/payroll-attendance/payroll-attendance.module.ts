import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayrollAttendanceController } from './payroll-attendance.controller';
import { PayrollAttendanceService } from './payroll-attendance.service';

@Module({
  imports: [AuthModule],
  controllers: [PayrollAttendanceController],
  providers: [PayrollAttendanceService],
  exports: [PayrollAttendanceService],
})
export class PayrollAttendanceModule {}
