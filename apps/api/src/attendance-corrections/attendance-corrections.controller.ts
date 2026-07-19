import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { AttendanceCorrectionsService } from './attendance-corrections.service';
import { AdminRequestCorrectionDto } from './dto/admin-request-correction.dto';
import { ListAttendanceCorrectionsQueryDto } from './dto/list-attendance-corrections.query.dto';
import { ListMyAttendanceCorrectionsQueryDto } from './dto/list-my-attendance-corrections.query.dto';
import { RejectCorrectionDto } from './dto/reject-correction.dto';
import { RequestCorrectionDto } from './dto/request-correction.dto';

@Controller('attendance-corrections')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendanceCorrectionsController {
  constructor(private readonly attendanceCorrectionsService: AttendanceCorrectionsService) {}

  @Get()
  @Permissions('attendanceCorrections.read')
  findAll(@Query() query: ListAttendanceCorrectionsQueryDto) {
    return this.attendanceCorrectionsService.findAll(query);
  }

  @Get('me')
  @Permissions('attendanceCorrections.readOwn')
  findMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMyAttendanceCorrectionsQueryDto) {
    return this.attendanceCorrectionsService.findMine(user.userId, query);
  }

  @Get(':id')
  @Permissions('attendanceCorrections.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.attendanceCorrectionsService.findOne(id);
  }

  @Post('request')
  @Permissions('attendanceCorrections.request')
  request(@Body() dto: RequestCorrectionDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.attendanceCorrectionsService.requestForSelf(dto, user.userId, getRequestContext(req));
  }

  @Post('admin-request')
  @Permissions('attendanceCorrections.approve')
  adminRequest(@Body() dto: AdminRequestCorrectionDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.attendanceCorrectionsService.requestForEmployee(dto, user.userId, getRequestContext(req));
  }

  @Post(':id/approve')
  @Permissions('attendanceCorrections.approve')
  approve(@Param('id', ParseCuidPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.attendanceCorrectionsService.approveCorrection(id, user.userId, getRequestContext(req));
  }

  @Post(':id/reject')
  @Permissions('attendanceCorrections.reject')
  reject(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: RejectCorrectionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.attendanceCorrectionsService.rejectCorrection(id, dto, user.userId, getRequestContext(req));
  }
}
