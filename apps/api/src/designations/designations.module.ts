import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DesignationsController } from './designations.controller';
import { DesignationsService } from './designations.service';

@Module({
  imports: [AuthModule],
  controllers: [DesignationsController],
  providers: [DesignationsService],
})
export class DesignationsModule {}
