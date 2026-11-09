import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttendanceCorrectionsModule } from './attendance-corrections/attendance-corrections.module';
import { AttendanceDevicesModule } from './attendance-devices/attendance-devices.module';
import { AttendancePunchesModule } from './attendance-punches/attendance-punches.module';
import { AttendanceSummariesModule } from './attendance-summaries/attendance-summaries.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { DepartmentsModule } from './departments/departments.module';
import { DesignationsModule } from './designations/designations.module';
import { EmployeesModule } from './employees/employees.module';
import { HealthModule } from './health/health.module';
import { MobileDevicesModule } from './mobile-devices/mobile-devices.module';
import { PayrollAttendanceModule } from './payroll-attendance/payroll-attendance.module';
import { PayrollLocksModule } from './payroll-locks/payroll-locks.module';
import { UsersModule } from './users/users.module';
import { WorkCalendarsModule } from './work-calendars/work-calendars.module';
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
    UsersModule,
    AttendanceDevicesModule,
    MobileDevicesModule,
    AttendancePunchesModule,
    PayrollLocksModule,
    PayrollAttendanceModule,
    WorkCalendarsModule,
    AttendanceSummariesModule,
    AttendanceCorrectionsModule,
  ],
})
export class AppModule {}
