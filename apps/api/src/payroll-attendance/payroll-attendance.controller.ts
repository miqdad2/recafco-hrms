import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { MonthlyAttendanceFilterDto, MonthlyAttendanceListQueryDto, MonthQueryDto } from './dto/monthly-attendance.query.dto';
import { PayrollAttendanceService } from './payroll-attendance.service';

/**
 * Monthly attendance payroll basis — READ-ONLY (Unit 20.2). Minutes and day counts only: no
 * salary amounts, deductions or payslips. Restricted to `payrollAttendance.read`; there is no
 * employee self-service route here.
 *
 * Static routes (`monthly`, `monthly/summary`) are declared before `monthly/:employeeId`.
 */
@Controller('payroll-attendance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollAttendanceController {
  constructor(private readonly payrollAttendanceService: PayrollAttendanceService) {}

  @Get('monthly')
  @Permissions('payrollAttendance.read')
  listMonthly(@Query() query: MonthlyAttendanceListQueryDto) {
    return this.payrollAttendanceService.listMonthly(query);
  }

  @Get('monthly/summary')
  @Permissions('payrollAttendance.read')
  summary(@Query() query: MonthlyAttendanceFilterDto) {
    return this.payrollAttendanceService.summary(query);
  }

  @Get('monthly/:employeeId')
  @Permissions('payrollAttendance.read')
  employeeMonth(@Param('employeeId', ParseCuidPipe) employeeId: string, @Query() query: MonthQueryDto) {
    return this.payrollAttendanceService.employeeMonth(employeeId, query.month);
  }
}
