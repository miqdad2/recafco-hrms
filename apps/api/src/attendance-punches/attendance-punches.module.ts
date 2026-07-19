import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttendancePunchesController } from './attendance-punches.controller';
import { AttendancePunchesService } from './attendance-punches.service';
import { AttendanceValidationService } from './attendance-validation.service';

@Module({
  imports: [AuthModule],
  controllers: [AttendancePunchesController],
  providers: [AttendancePunchesService, AttendanceValidationService],
})
export class AttendancePunchesModule {}
