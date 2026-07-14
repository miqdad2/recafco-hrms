import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { isUniqueConstraintError } from '../common/prisma-error.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { CreateWorkLocationDto } from './dto/create-work-location.dto';
import { ListWorkLocationsQueryDto } from './dto/list-work-locations.query.dto';
import { UpdateWorkLocationDto } from './dto/update-work-location.dto';

@Injectable()
export class WorkLocationsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async findAll(query: ListWorkLocationsQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.WorkLocationWhereInput = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.type) {
      where.type = query.type;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { address: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.workLocation.findMany({
        where,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.workLocation.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const workLocation = await this.prisma.workLocation.findUnique({ where: { id } });
    if (!workLocation) {
      throw new NotFoundException('Work location not found');
    }
    return workLocation;
  }

  async create(dto: CreateWorkLocationDto, actorUserId: string, context: RequestContext) {
    try {
      const workLocation = await this.prisma.workLocation.create({ data: dto });

      await this.auditService.record({
        actorUserId,
        entityType: 'WorkLocation',
        entityId: workLocation.id,
        action: 'WORK_LOCATION_CREATED',
        afterSnapshot: toJsonSnapshot(workLocation),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return workLocation;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('A work location with this code already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateWorkLocationDto, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);

    try {
      const updated = await this.prisma.workLocation.update({ where: { id }, data: dto });

      await this.auditService.record({
        actorUserId,
        entityType: 'WorkLocation',
        entityId: id,
        action: 'WORK_LOCATION_UPDATED',
        beforeSnapshot: toJsonSnapshot(existing),
        afterSnapshot: toJsonSnapshot(updated),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('A work location with this code already exists');
      }
      throw error;
    }
  }

  async deactivate(id: string, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);
    if (!existing.isActive) {
      return existing;
    }

    const updated = await this.prisma.workLocation.update({ where: { id }, data: { isActive: false } });

    await this.auditService.record({
      actorUserId,
      entityType: 'WorkLocation',
      entityId: id,
      action: 'WORK_LOCATION_DEACTIVATED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }
}
