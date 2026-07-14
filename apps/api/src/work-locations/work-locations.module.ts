import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkLocationsController } from './work-locations.controller';
import { WorkLocationsService } from './work-locations.service';

@Module({
  imports: [AuthModule],
  controllers: [WorkLocationsController],
  providers: [WorkLocationsService],
})
export class WorkLocationsModule {}
