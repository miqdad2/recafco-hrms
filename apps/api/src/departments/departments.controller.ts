import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { ListDepartmentsQueryDto } from './dto/list-departments.query.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Controller('departments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @Permissions('departments.read')
  findAll(@Query() query: ListDepartmentsQueryDto) {
    return this.departmentsService.findAll(query);
  }

  @Get(':id')
  @Permissions('departments.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.departmentsService.findOne(id);
  }

  @Post()
  @Permissions('departments.create')
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.departmentsService.create(dto, user.userId, getRequestContext(req));
  }

  @Patch(':id')
  @Permissions('departments.update')
  update(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.departmentsService.update(id, dto, user.userId, getRequestContext(req));
  }

  @Delete(':id')
  @Permissions('departments.disable')
  deactivate(@Param('id', ParseCuidPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.departmentsService.deactivate(id, user.userId, getRequestContext(req));
  }
}
