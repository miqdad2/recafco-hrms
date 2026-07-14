import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { isUniqueConstraintError } from '../common/prisma-error.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { ListDepartmentsQueryDto } from './dto/list-departments.query.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async findAll(query: ListDepartmentsQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.DepartmentWhereInput = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.department.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return department;
  }

  async create(dto: CreateDepartmentDto, actorUserId: string, context: RequestContext) {
    try {
      const department = await this.prisma.department.create({ data: dto });

      await this.auditService.record({
        actorUserId,
        entityType: 'Department',
        entityId: department.id,
        action: 'DEPARTMENT_CREATED',
        afterSnapshot: toJsonSnapshot(department),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return department;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('A department with this name or code already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateDepartmentDto, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);

    try {
      const updated = await this.prisma.department.update({ where: { id }, data: dto });

      await this.auditService.record({
        actorUserId,
        entityType: 'Department',
        entityId: id,
        action: 'DEPARTMENT_UPDATED',
        beforeSnapshot: toJsonSnapshot(existing),
        afterSnapshot: toJsonSnapshot(updated),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('A department with this name or code already exists');
      }
      throw error;
    }
  }

  async deactivate(id: string, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);
    if (!existing.isActive) {
      return existing;
    }

    const updated = await this.prisma.department.update({ where: { id }, data: { isActive: false } });

    await this.auditService.record({
      actorUserId,
      entityType: 'Department',
      entityId: id,
      action: 'DEPARTMENT_DEACTIVATED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }
}
