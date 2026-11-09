import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import { getRequestContext } from '../common/request-context.util';
import {
  ActivateDto,
  CreateAssignmentDto,
  CreateDayOverrideDto,
  CreatePublicHolidayDto,
  CreateWorkCalendarDto,
  DeactivateDto,
  EndAssignmentDto,
  ListAssignmentsQueryDto,
  ListHolidaysQueryDto,
  ListOverridesQueryDto,
  MonthQueryDto,
  UpdatePublicHolidayDto,
  UpdateWorkCalendarDto,
} from './dto/work-calendar.dto';
import { WorkCalendarsService } from './work-calendars.service';

/**
 * HR-POLICY-01. Permissions:
 *  - workCalendars.read      view calendars, holidays, assignments, previews, coverage
 *  - workCalendars.manage    create/edit DRAFTS (calendars, holidays, day overrides)
 *  - workCalendars.activate  approve (activate) and change what is in effect: activate/deactivate,
 *                            assign/end assignments. Granted to SUPER_ADMIN only until HR decides
 *                            who may approve calendars (decision register HRP-02).
 * Static routes are declared before `:id` routes.
 */
@Controller('work-calendars')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkCalendarsController {
  constructor(private readonly service: WorkCalendarsService) {}

  @Get()
  @Permissions('workCalendars.read')
  list() {
    return this.service.listCalendars();
  }

  @Get('assignments')
  @Permissions('workCalendars.read')
  listAssignments(@Query() query: ListAssignmentsQueryDto) {
    return this.service.listAssignments(query);
  }

  @Post('assignments')
  @Permissions('workCalendars.activate')
  createAssignment(@Body() dto: CreateAssignmentDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.createAssignment(dto, user.userId, getRequestContext(req));
  }

  @Post('assignments/:id/end')
  @Permissions('workCalendars.activate')
  endAssignment(@Param('id', ParseCuidPipe) id: string, @Body() dto: EndAssignmentDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.endAssignment(id, dto, user.userId, getRequestContext(req));
  }

  @Get('overrides')
  @Permissions('workCalendars.read')
  listOverrides(@Query() query: ListOverridesQueryDto) {
    return this.service.listOverrides(query);
  }

  @Post('overrides')
  @Permissions('workCalendars.manage')
  createOverride(@Body() dto: CreateDayOverrideDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.createOverride(dto, user.userId, getRequestContext(req));
  }

  @Post('overrides/:id/activate')
  @Permissions('workCalendars.activate')
  activateOverride(@Param('id', ParseCuidPipe) id: string, @Body() dto: ActivateDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.activateOverride(id, dto, user.userId, getRequestContext(req));
  }

  @Post('overrides/:id/deactivate')
  @Permissions('workCalendars.activate')
  deactivateOverride(@Param('id', ParseCuidPipe) id: string, @Body() dto: DeactivateDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.deactivateOverride(id, dto, user.userId, getRequestContext(req));
  }

  @Get('coverage')
  @Permissions('workCalendars.read')
  coverage(@Query() query: MonthQueryDto) {
    return this.service.coverage(query.month);
  }

  @Get('shift-options')
  @Permissions('workCalendars.read')
  shiftOptions() {
    return this.service.shiftOptions();
  }

  @Get('employees/:employeeId/preview')
  @Permissions('workCalendars.read')
  previewEmployee(@Param('employeeId', ParseCuidPipe) employeeId: string, @Query() query: MonthQueryDto) {
    return this.service.previewEmployee(employeeId, query.month);
  }

  @Post()
  @Permissions('workCalendars.manage')
  create(@Body() dto: CreateWorkCalendarDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.createCalendar(dto, user.userId, getRequestContext(req));
  }

  @Get(':id')
  @Permissions('workCalendars.read')
  get(@Param('id', ParseCuidPipe) id: string) {
    return this.service.getCalendar(id);
  }

  @Get(':id/preview')
  @Permissions('workCalendars.read')
  preview(@Param('id', ParseCuidPipe) id: string, @Query() query: MonthQueryDto) {
    return this.service.previewCalendar(id, query.month);
  }

  @Patch(':id')
  @Permissions('workCalendars.manage')
  update(@Param('id', ParseCuidPipe) id: string, @Body() dto: UpdateWorkCalendarDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.updateCalendar(id, dto, user.userId, getRequestContext(req));
  }

  @Post(':id/activate')
  @Permissions('workCalendars.activate')
  activate(@Param('id', ParseCuidPipe) id: string, @Body() dto: ActivateDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.activateCalendar(id, dto, user.userId, getRequestContext(req));
  }
}

@Controller('public-holidays')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PublicHolidaysController {
  constructor(private readonly service: WorkCalendarsService) {}

  @Get()
  @Permissions('workCalendars.read')
  list(@Query() query: ListHolidaysQueryDto) {
    return this.service.listHolidays(query);
  }

  @Post()
  @Permissions('workCalendars.manage')
  create(@Body() dto: CreatePublicHolidayDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.createHoliday(dto, user.userId, getRequestContext(req));
  }

  @Patch(':id')
  @Permissions('workCalendars.manage')
  update(@Param('id', ParseCuidPipe) id: string, @Body() dto: UpdatePublicHolidayDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.updateHoliday(id, dto, user.userId, getRequestContext(req));
  }

  @Post(':id/activate')
  @Permissions('workCalendars.activate')
  activate(@Param('id', ParseCuidPipe) id: string, @Body() dto: ActivateDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.activateHoliday(id, dto, user.userId, getRequestContext(req));
  }

  @Post(':id/deactivate')
  @Permissions('workCalendars.activate')
  deactivate(@Param('id', ParseCuidPipe) id: string, @Body() dto: DeactivateDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.deactivateHoliday(id, dto, user.userId, getRequestContext(req));
  }
}
