import {
  Body,
  Controller,
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
import { ApproveMobileDeviceDto } from './dto/approve-mobile-device.dto';
import { BlockMobileDeviceDto } from './dto/block-mobile-device.dto';
import { ListMobileDevicesQueryDto } from './dto/list-mobile-devices.query.dto';
import { RegisterMobileDeviceDto } from './dto/register-mobile-device.dto';
import { UpdateMobileDeviceDto } from './dto/update-mobile-device.dto';
import { MobileDevicesService } from './mobile-devices.service';

@Controller('mobile-devices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MobileDevicesController {
  constructor(private readonly mobileDevicesService: MobileDevicesService) {}

  @Get()
  @Permissions('mobileDevices.read')
  findAll(@Query() query: ListMobileDevicesQueryDto) {
    return this.mobileDevicesService.findAll(query);
  }

  @Get('me')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.mobileDevicesService.findMine(user.userId);
  }

  @Get(':id')
  @Permissions('mobileDevices.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.mobileDevicesService.findOne(id);
  }

  @Post('register')
  @Permissions('mobileDevices.register')
  register(
    @Body() dto: RegisterMobileDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.mobileDevicesService.register(dto, user.userId, getRequestContext(req));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('mobileDevices.approve')
  approve(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: ApproveMobileDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.mobileDevicesService.approve(id, dto, user.userId, getRequestContext(req));
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @Permissions('mobileDevices.block')
  block(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: BlockMobileDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.mobileDevicesService.block(id, dto, user.userId, getRequestContext(req));
  }

  @Post(':id/reset')
  @HttpCode(HttpStatus.OK)
  @Permissions('mobileDevices.reset')
  reset(@Param('id', ParseCuidPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.mobileDevicesService.reset(id, user.userId, getRequestContext(req));
  }

  @Patch(':id')
  @Permissions('mobileDevices.update')
  update(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateMobileDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.mobileDevicesService.update(id, dto, user.userId, getRequestContext(req));
  }
}
