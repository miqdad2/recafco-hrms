import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { AttendanceDevicesService } from './attendance-devices.service';
import { CreateAttendanceDeviceDto } from './dto/create-attendance-device.dto';
import { ListAttendanceDevicesQueryDto } from './dto/list-attendance-devices.query.dto';
import { UpdateAttendanceDeviceDto } from './dto/update-attendance-device.dto';

@Controller('attendance-devices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendanceDevicesController {
  constructor(private readonly attendanceDevicesService: AttendanceDevicesService) {}

  @Get()
  @Permissions('attendanceDevices.read')
  findAll(@Query() query: ListAttendanceDevicesQueryDto) {
    return this.attendanceDevicesService.findAll(query);
  }

  @Get(':id')
  @Permissions('attendanceDevices.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.attendanceDevicesService.findOne(id);
  }

  @Post()
  @Permissions('attendanceDevices.create')
  create(
    @Body() dto: CreateAttendanceDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.attendanceDevicesService.create(dto, user.userId, getRequestContext(req));
  }

  @Patch(':id')
  @Permissions('attendanceDevices.update')
  update(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateAttendanceDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.attendanceDevicesService.update(id, dto, user.userId, getRequestContext(req));
  }

  @Delete(':id')
  @Permissions('attendanceDevices.disable')
  deactivate(@Param('id', ParseCuidPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.attendanceDevicesService.deactivate(id, user.userId, getRequestContext(req));
  }

  @Post(':id/test-connection')
  @HttpCode(HttpStatus.OK)
  @Permissions('attendanceDevices.testConnection')
  testConnection(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.attendanceDevicesService.testConnection(id, user.userId, getRequestContext(req));
  }
}
