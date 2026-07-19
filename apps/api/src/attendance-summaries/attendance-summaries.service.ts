import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@recafco/db';
import { dateRangeFilter } from '../common/date-range.util';
import { resolveEmployeeIdForUser } from '../common/current-employee.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { DatabaseService } from '../database/database.service';
import { ListAttendanceSummariesQueryDto } from './dto/list-attendance-summaries.query.dto';
import { ListMyAttendanceSummariesQueryDto } from './dto/list-my-attendance-summaries.query.dto';

const RELATIONS_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, departmentId: true } },
  officialInPunch: { select: { id: true, sourceType: true, punchTimeSource: true } },
  officialOutPunch: { select: { id: true, sourceType: true, punchTimeSource: true } },
} satisfies Prisma.AttendanceDailySummaryInclude;

@Injectable()
export class AttendanceSummariesService {
  constructor(private readonly databaseService: DatabaseService) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async findAll(query: ListAttendanceSummariesQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.AttendanceDailySummaryWhereInput = {};
    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }
    if (query.departmentId) {
      where.employee = { departmentId: query.departmentId };
    }
    if (query.status) {
      where.status = query.status;
    }
    const workDate = dateRangeFilter(query.from, query.to);
    if (workDate) {
      where.workDate = workDate;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceDailySummary.findMany({
        where,
        include: RELATIONS_INCLUDE,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { workDate: 'desc' },
      }),
      this.prisma.attendanceDailySummary.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const summary = await this.prisma.attendanceDailySummary.findUnique({ where: { id }, include: RELATIONS_INCLUDE });
    if (!summary) {
      throw new NotFoundException('Attendance daily summary not found');
    }
    return summary;
  }

  async findMine(userId: string, query: ListMyAttendanceSummariesQueryDto): Promise<PaginatedResult<unknown>> {
    const employeeId = await resolveEmployeeIdForUser(this.prisma, userId);

    const where: Prisma.AttendanceDailySummaryWhereInput = { employeeId };
    const workDate = dateRangeFilter(query.from, query.to);
    if (workDate) {
      where.workDate = workDate;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceDailySummary.findMany({
        where,
        include: RELATIONS_INCLUDE,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { workDate: 'desc' },
      }),
      this.prisma.attendanceDailySummary.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }
}
