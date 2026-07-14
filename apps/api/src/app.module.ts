import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { DepartmentsModule } from './departments/departments.module';
import { DesignationsModule } from './designations/designations.module';
import { EmployeesModule } from './employees/employees.module';
import { HealthModule } from './health/health.module';
import { WorkLocationsModule } from './work-locations/work-locations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    AuditModule,
    HealthModule,
    AuthModule,
    DepartmentsModule,
    DesignationsModule,
    WorkLocationsModule,
    EmployeesModule,
  ],
})
export class AppModule {}
