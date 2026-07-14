import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { isUniqueConstraintError } from '../common/prisma-error.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { CreateDesignationDto } from './dto/create-designation.dto';
import { ListDesignationsQueryDto } from './dto/list-designations.query.dto';
import { UpdateDesignationDto } from './dto/update-designation.dto';

@Injectable()
export class DesignationsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async findAll(query: ListDesignationsQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.DesignationWhereInput = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.designation.findMany({
        where,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { title: 'asc' },
      }),
      this.prisma.designation.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const designation = await this.prisma.designation.findUnique({ where: { id } });
    if (!designation) {
      throw new NotFoundException('Designation not found');
    }
    return designation;
  }

  async create(dto: CreateDesignationDto, actorUserId: string, context: RequestContext) {
    try {
      const designation = await this.prisma.designation.create({ data: dto });

      await this.auditService.record({
        actorUserId,
        entityType: 'Designation',
        entityId: designation.id,
        action: 'DESIGNATION_CREATED',
        afterSnapshot: toJsonSnapshot(designation),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return designation;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('A designation with this title or code already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateDesignationDto, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);

    try {
      const updated = await this.prisma.designation.update({ where: { id }, data: dto });

      await this.auditService.record({
        actorUserId,
        entityType: 'Designation',
        entityId: id,
        action: 'DESIGNATION_UPDATED',
        beforeSnapshot: toJsonSnapshot(existing),
        afterSnapshot: toJsonSnapshot(updated),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('A designation with this title or code already exists');
      }
      throw error;
    }
  }

  async deactivate(id: string, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);
    if (!existing.isActive) {
      return existing;
    }

    const updated = await this.prisma.designation.update({ where: { id }, data: { isActive: false } });

    await this.auditService.record({
      actorUserId,
      entityType: 'Designation',
      entityId: id,
      action: 'DESIGNATION_DEACTIVATED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }
}
