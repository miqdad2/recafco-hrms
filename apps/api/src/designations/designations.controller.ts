import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { CreateDesignationDto } from './dto/create-designation.dto';
import { ListDesignationsQueryDto } from './dto/list-designations.query.dto';
import { UpdateDesignationDto } from './dto/update-designation.dto';
import { DesignationsService } from './designations.service';

@Controller('designations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DesignationsController {
  constructor(private readonly designationsService: DesignationsService) {}

  @Get()
  @Permissions('designations.read')
  findAll(@Query() query: ListDesignationsQueryDto) {
    return this.designationsService.findAll(query);
  }

  @Get(':id')
  @Permissions('designations.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.designationsService.findOne(id);
  }

  @Post()
  @Permissions('designations.create')
  create(@Body() dto: CreateDesignationDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.designationsService.create(dto, user.userId, getRequestContext(req));
  }

  @Patch(':id')
  @Permissions('designations.update')
  update(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateDesignationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.designationsService.update(id, dto, user.userId, getRequestContext(req));
  }

  @Delete(':id')
  @Permissions('designations.disable')
  deactivate(@Param('id', ParseCuidPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.designationsService.deactivate(id, user.userId, getRequestContext(req));
  }
}
