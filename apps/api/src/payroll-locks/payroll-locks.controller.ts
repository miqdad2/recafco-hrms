import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import { CreatePayrollLockDto } from './dto/create-payroll-lock.dto';
import { ListPayrollLocksQueryDto } from './dto/list-payroll-locks.query.dto';
import { UnlockPayrollLockDto } from './dto/unlock-payroll-lock.dto';
import { PayrollLocksService } from './payroll-locks.service';

@Controller('payroll-locks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollLocksController {
  constructor(private readonly payrollLocksService: PayrollLocksService) {}

  @Get()
  @Permissions('payrollLocks.read')
  findAll(@Query() query: ListPayrollLocksQueryDto) {
    return this.payrollLocksService.findAll(query);
  }

  /** Unit 21.1 — whether this exact period can be locked (read-only; not payroll approval). */
  @Get(':id/readiness')
  @Permissions('payrollLocks.read')
  readiness(@Param('id', ParseCuidPipe) id: string) {
    return this.payrollLocksService.readiness(id);
  }

  @Get(':id')
  @Permissions('payrollLocks.read')
  findOne(@Param('id', ParseCuidPipe) id: string) {
    return this.payrollLocksService.findOne(id);
  }

  @Post()
  @Permissions('payrollLocks.create')
  create(@Body() dto: CreatePayrollLockDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.payrollLocksService.create(dto, user.userId, getRequestContext(req));
  }

  @Post(':id/lock')
  @Permissions('payrollLocks.lock')
  lock(@Param('id', ParseCuidPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.payrollLocksService.lockPeriod(id, user.userId, getRequestContext(req));
  }

  @Post(':id/unlock')
  @Permissions('payrollLocks.unlock')
  unlock(
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UnlockPayrollLockDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.payrollLocksService.unlockPeriod(id, dto, user.userId, getRequestContext(req));
  }
}
