import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { AttendancePunchesService } from './attendance-punches.service';
import { AttendanceValidationService } from './attendance-validation.service';
import { CreateDeviceImportPunchDto } from './dto/create-device-import-punch.dto';
import { CreateManualPunchDto } from './dto/create-manual-punch.dto';
import { CreateMobilePunchDto } from './dto/create-mobile-punch.dto';
import { ListAttendancePunchesQueryDto } from './dto/list-attendance-punches.query.dto';
import { ListMyAttendancePunchesQueryDto } from './dto/list-my-attendance-punches.query.dto';
import { ValidatePendingDto } from './dto/validate-pending.dto';

@Controller('attendance-punches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendancePunchesController {
  constructor(
    private readonly attendancePunchesService: AttendancePunchesService,
    private readonly attendanceValidationService: AttendanceValidationService,
  ) {}

  @Get()
  @Permissions('attendancePunches.read')
  findAll(@Query() query: ListAttendancePunchesQueryDto) {
    return this.attendancePunchesService.findAll(query);
  }

  @Get('me')
  @Permissions('attendancePunches.readOwn')
  findMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMyAttendancePunchesQueryDto) {
    return this.attendancePunchesService.findMine(user.userId, query);
  }

  @Get(':id')
  @Permissions('attendancePunches.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.attendancePunchesService.findOne(id);
  }

  @Post('mobile')
  @Permissions('attendancePunches.createMobile')
  createMobile(
    @Body() dto: CreateMobilePunchDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.attendancePunchesService.createMobile(dto, user.userId, getRequestContext(req));
  }

  @Post('device-import')
  @HttpCode(HttpStatus.OK)
  @Permissions('attendancePunches.createDeviceImport')
  createDeviceImport(
    @Body() dto: CreateDeviceImportPunchDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.attendancePunchesService.createDeviceImport(dto, user.userId, getRequestContext(req));
  }

  @Post('manual')
  @Permissions('attendancePunches.createManual')
  createManual(
    @Body() dto: CreateManualPunchDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.attendancePunchesService.createManual(dto, user.userId, getRequestContext(req));
  }

  @Post(':id/validate')
  @Permissions('attendancePunches.validate')
  validateOne(@Param('id', ParseCuidPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.attendanceValidationService.validatePunch(id, user.userId, getRequestContext(req));
  }

  @Post('validate-pending')
  @Permissions('attendancePunches.validate')
  validatePending(@Body() dto: ValidatePendingDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.attendanceValidationService.validatePending(dto, user.userId, getRequestContext(req));
  }
}
