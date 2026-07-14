import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees.query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @Permissions('employees.read')
  findAll(@Query() query: ListEmployeesQueryDto) {
    return this.employeesService.findAll(query);
  }

  @Get(':id')
  @Permissions('employees.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.employeesService.findOne(id);
  }

  @Post()
  @Permissions('employees.create')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.employeesService.create(dto, user.userId, getRequestContext(req));
  }

  @Patch(':id')
  @Permissions('employees.update')
  update(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.employeesService.update(id, dto, user.userId, getRequestContext(req));
  }

  @Delete(':id')
  @Permissions('employees.disable')
  terminate(@Param('id', ParseCuidPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.employeesService.terminate(id, user.userId, getRequestContext(req));
  }
}
