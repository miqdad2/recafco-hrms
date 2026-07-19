import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MobileDeviceStatus, type Prisma } from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { resolveEmployeeIdForUser } from '../common/current-employee.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { isUniqueConstraintError } from '../common/prisma-error.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { ApproveMobileDeviceDto } from './dto/approve-mobile-device.dto';
import { BlockMobileDeviceDto } from './dto/block-mobile-device.dto';
import { ListMobileDevicesQueryDto } from './dto/list-mobile-devices.query.dto';
import { RegisterMobileDeviceDto } from './dto/register-mobile-device.dto';
import { UpdateMobileDeviceDto } from './dto/update-mobile-device.dto';

@Injectable()
export class MobileDevicesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async findAll(query: ListMobileDevicesQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.MobileDeviceWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.platform) {
      where.platform = query.platform;
    }
    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }
    if (query.isPrimary !== undefined) {
      where.isPrimary = query.isPrimary;
    }
    if (query.search) {
      where.OR = [
        { deviceIdentifier: { contains: query.search, mode: 'insensitive' } },
        { deviceName: { contains: query.search, mode: 'insensitive' } },
        { manufacturer: { contains: query.search, mode: 'insensitive' } },
        { model: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.mobileDevice.findMany({
        where,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.mobileDevice.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const device = await this.prisma.mobileDevice.findUnique({ where: { id } });
    if (!device) {
      throw new NotFoundException('Mobile device not found');
    }
    return device;
  }

  async findMine(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.employeeId) {
      return [];
    }
    return this.prisma.mobileDevice.findMany({
      where: { employeeId: user.employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async register(dto: RegisterMobileDeviceDto, userId: string, context: RequestContext) {
    const employeeId = await resolveEmployeeIdForUser(this.prisma, userId);

    const existing = await this.prisma.mobileDevice.findUnique({
      where: { deviceIdentifier: dto.deviceIdentifier },
    });

    if (existing) {
      if (existing.employeeId !== employeeId) {
        throw new ConflictException('This device is already registered to a different employee');
      }

      const updated = await this.prisma.mobileDevice.update({
        where: { id: existing.id },
        data: {
          platform: dto.platform,
          deviceName: dto.deviceName ?? null,
          manufacturer: dto.manufacturer ?? null,
          model: dto.model ?? null,
          osVersion: dto.osVersion ?? null,
          appVersion: dto.appVersion ?? null,
          lastSeenAt: new Date(),
        },
      });

      await this.auditService.record({
        actorUserId: userId,
        entityType: 'MobileDevice',
        entityId: updated.id,
        action: 'MOBILE_DEVICE_REGISTRATION_REFRESHED',
        beforeSnapshot: toJsonSnapshot(existing),
        afterSnapshot: toJsonSnapshot(updated),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated;
    }

    const data: Prisma.MobileDeviceUncheckedCreateInput = {
      employeeId,
      deviceIdentifier: dto.deviceIdentifier,
      platform: dto.platform,
      deviceName: dto.deviceName ?? null,
      manufacturer: dto.manufacturer ?? null,
      model: dto.model ?? null,
      osVersion: dto.osVersion ?? null,
      appVersion: dto.appVersion ?? null,
      lastSeenAt: new Date(),
    };

    try {
      const device = await this.prisma.mobileDevice.create({ data });

      await this.auditService.record({
        actorUserId: userId,
        entityType: 'MobileDevice',
        entityId: device.id,
        action: 'MOBILE_DEVICE_REGISTERED',
        afterSnapshot: toJsonSnapshot(device),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return device;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('This device is already registered to a different employee');
      }
      throw error;
    }
  }

  async approve(id: string, dto: ApproveMobileDeviceDto, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);

    if (existing.status === MobileDeviceStatus.BLOCKED) {
      throw new BadRequestException('Blocked devices cannot be approved directly; reset the device first');
    }

    const makePrimary = dto.isPrimary ?? true;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (makePrimary) {
        await tx.mobileDevice.updateMany({
          where: { employeeId: existing.employeeId, id: { not: id }, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return tx.mobileDevice.update({
        where: { id },
        data: {
          status: MobileDeviceStatus.APPROVED,
          isPrimary: makePrimary,
          approvedAt: new Date(),
          approvedByUserId: actorUserId,
          blockedAt: null,
          blockedByUserId: null,
          blockReason: null,
        },
      });
    });

    await this.auditService.record({
      actorUserId,
      entityType: 'MobileDevice',
      entityId: id,
      action: 'MOBILE_DEVICE_APPROVED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }

  async block(id: string, dto: BlockMobileDeviceDto, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);

    const updated = await this.prisma.mobileDevice.update({
      where: { id },
      data: {
        status: MobileDeviceStatus.BLOCKED,
        isPrimary: false,
        blockedAt: new Date(),
        blockedByUserId: actorUserId,
        blockReason: dto.reason,
      },
    });

    await this.auditService.record({
      actorUserId,
      entityType: 'MobileDevice',
      entityId: id,
      action: 'MOBILE_DEVICE_BLOCKED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }

  async reset(id: string, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);

    const updated = await this.prisma.mobileDevice.update({
      where: { id },
      data: {
        status: MobileDeviceStatus.DEACTIVATED,
        isPrimary: false,
      },
    });

    await this.auditService.record({
      actorUserId,
      entityType: 'MobileDevice',
      entityId: id,
      action: 'MOBILE_DEVICE_RESET',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }

  async update(id: string, dto: UpdateMobileDeviceDto, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);

    const updated = await this.prisma.mobileDevice.update({ where: { id }, data: dto });

    await this.auditService.record({
      actorUserId,
      entityType: 'MobileDevice',
      entityId: id,
      action: 'MOBILE_DEVICE_UPDATED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }
}
