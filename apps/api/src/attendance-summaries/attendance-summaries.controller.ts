import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { AttendanceSummariesService } from './attendance-summaries.service';
import { AttendanceSummaryCalculatorService } from './attendance-summary-calculator.service';
import { CalculateSummaryDto } from './dto/calculate-summary.dto';
import { ListAttendanceSummariesQueryDto } from './dto/list-attendance-summaries.query.dto';
import { ListMyAttendanceSummariesQueryDto } from './dto/list-my-attendance-summaries.query.dto';
import { RecalculateRangeDto } from './dto/recalculate-range.dto';

@Controller('attendance-summaries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendanceSummariesController {
  constructor(
    private readonly attendanceSummariesService: AttendanceSummariesService,
    private readonly attendanceSummaryCalculatorService: AttendanceSummaryCalculatorService,
  ) {}

  @Get()
  @Permissions('attendanceSummaries.read')
  findAll(@Query() query: ListAttendanceSummariesQueryDto) {
    return this.attendanceSummariesService.findAll(query);
  }

  @Get('me')
  @Permissions('attendanceSummaries.readOwn')
  findMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMyAttendanceSummariesQueryDto) {
    return this.attendanceSummariesService.findMine(user.userId, query);
  }

  @Get(':id')
  @Permissions('attendanceSummaries.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.attendanceSummariesService.findOne(id);
  }

  @Post('calculate')
  @Permissions('attendanceSummaries.calculate')
  calculate(@Body() dto: CalculateSummaryDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.attendanceSummaryCalculatorService.calculateForEmployeeDate(
      dto.employeeId,
      dto.workDate,
      user.userId,
      getRequestContext(req),
    );
  }

  @Post('recalculate-range')
  @Permissions('attendanceSummaries.recalculate')
  recalculateRange(@Body() dto: RecalculateRangeDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.attendanceSummaryCalculatorService.recalculateRange(dto, user.userId, getRequestContext(req));
  }
}
