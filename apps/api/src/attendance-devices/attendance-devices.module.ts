import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttendanceDevicesController } from './attendance-devices.controller';
import { AttendanceDevicesService } from './attendance-devices.service';

@Module({
  imports: [AuthModule],
  controllers: [AttendanceDevicesController],
  providers: [AttendanceDevicesService],
})
export class AttendanceDevicesModule {}
