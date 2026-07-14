import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { CreateWorkLocationDto } from './dto/create-work-location.dto';
import { ListWorkLocationsQueryDto } from './dto/list-work-locations.query.dto';
import { UpdateWorkLocationDto } from './dto/update-work-location.dto';
import { WorkLocationsService } from './work-locations.service';

@Controller('work-locations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkLocationsController {
  constructor(private readonly workLocationsService: WorkLocationsService) {}

  @Get()
  @Permissions('workLocations.read')
  findAll(@Query() query: ListWorkLocationsQueryDto) {
    return this.workLocationsService.findAll(query);
  }

  @Get(':id')
  @Permissions('workLocations.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.workLocationsService.findOne(id);
  }

  @Post()
  @Permissions('workLocations.create')
  create(@Body() dto: CreateWorkLocationDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.workLocationsService.create(dto, user.userId, getRequestContext(req));
  }

  @Patch(':id')
  @Permissions('workLocations.update')
  update(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateWorkLocationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.workLocationsService.update(id, dto, user.userId, getRequestContext(req));
  }

  @Delete(':id')
  @Permissions('workLocations.disable')
  deactivate(@Param('id', ParseCuidPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.workLocationsService.deactivate(id, user.userId, getRequestContext(req));
  }
}
