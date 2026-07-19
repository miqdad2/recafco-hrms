import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MobileDevicesController } from './mobile-devices.controller';
import { MobileDevicesService } from './mobile-devices.service';

@Module({
  imports: [AuthModule],
  controllers: [MobileDevicesController],
  providers: [MobileDevicesService],
})
export class MobileDevicesModule {}
