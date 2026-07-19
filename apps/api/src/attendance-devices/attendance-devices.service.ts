import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceDeviceType, AttendanceSourceType, type Prisma } from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { isUniqueConstraintError } from '../common/prisma-error.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { CreateAttendanceDeviceDto } from './dto/create-attendance-device.dto';
import { ListAttendanceDevicesQueryDto } from './dto/list-attendance-devices.query.dto';
import { UpdateAttendanceDeviceDto } from './dto/update-attendance-device.dto';

/**
 * `deviceType` (hardware category, user-facing) determines `sourceType` (the existing
 * AttendanceSourceType used to tag raw punches for the attendance engine, per Unit 1's
 * architecture — not user-editable here). QR_TERMINAL/TURNSTILE/OTHER have no dedicated
 * AttendanceSourceType yet, so they fall back to FUTURE_INTEGRATION (its designated
 * catch-all) until the validation engine needs to distinguish them.
 */
const DEVICE_TYPE_TO_SOURCE_TYPE: Record<AttendanceDeviceType, AttendanceSourceType> = {
  [AttendanceDeviceType.BIOMETRIC]: AttendanceSourceType.BIOMETRIC_DEVICE,
  [AttendanceDeviceType.FACE_RECOGNITION]: AttendanceSourceType.FACE_DEVICE,
  [AttendanceDeviceType.CARD]: AttendanceSourceType.CARD_DEVICE,
  [AttendanceDeviceType.QR_TERMINAL]: AttendanceSourceType.FUTURE_INTEGRATION,
  [AttendanceDeviceType.TURNSTILE]: AttendanceSourceType.FUTURE_INTEGRATION,
  [AttendanceDeviceType.OTHER]: AttendanceSourceType.FUTURE_INTEGRATION,
};

@Injectable()
export class AttendanceDevicesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  private async assertActiveWorkLocation(workLocationId: string): Promise<void> {
    const workLocation = await this.prisma.workLocation.findUnique({ where: { id: workLocationId } });
    if (!workLocation) {
      throw new BadRequestException('workLocationId does not reference an existing work location');
    }
    if (!workLocation.isActive) {
      throw new BadRequestException('workLocationId must reference an active work location');
    }
  }

  async findAll(query: ListAttendanceDevicesQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.AttendanceDeviceWhereInput = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.workLocationId) {
      where.workLocationId = query.workLocationId;
    }
    if (query.deviceType) {
      where.deviceType = query.deviceType;
    }
    if (query.connectionMode) {
      where.connectionMode = query.connectionMode;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { deviceCode: { contains: query.search, mode: 'insensitive' } },
        { vendor: { contains: query.search, mode: 'insensitive' } },
        { model: { contains: query.search, mode: 'insensitive' } },
        { serialNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceDevice.findMany({
        where,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.attendanceDevice.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const device = await this.prisma.attendanceDevice.findUnique({ where: { id } });
    if (!device) {
      throw new NotFoundException('Attendance device not found');
    }
    return device;
  }

  async create(dto: CreateAttendanceDeviceDto, actorUserId: string, context: RequestContext) {
    await this.assertActiveWorkLocation(dto.workLocationId);

    const data: Prisma.AttendanceDeviceUncheckedCreateInput = {
      deviceCode: dto.deviceCode,
      name: dto.name,
      deviceType: dto.deviceType,
      sourceType: DEVICE_TYPE_TO_SOURCE_TYPE[dto.deviceType],
      vendor: dto.vendor ?? null,
      model: dto.model ?? null,
      serialNumber: dto.serialNumber ?? null,
      workLocationId: dto.workLocationId,
      ipAddress: dto.ipAddress ?? null,
      port: dto.port ?? null,
      notes: dto.notes ?? null,
    };
    if (dto.connectionMode !== undefined) {
      data.connectionMode = dto.connectionMode;
    }

    try {
      const device = await this.prisma.attendanceDevice.create({ data });

      await this.auditService.record({
        actorUserId,
        entityType: 'AttendanceDevice',
        entityId: device.id,
        action: 'ATTENDANCE_DEVICE_CREATED',
        afterSnapshot: toJsonSnapshot(device),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return device;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('An attendance device with this code or serial number already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateAttendanceDeviceDto, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);

    if (dto.workLocationId) {
      await this.assertActiveWorkLocation(dto.workLocationId);
    }

    const data: Prisma.AttendanceDeviceUncheckedUpdateInput = { ...dto };
    if (dto.deviceType !== undefined) {
      data.sourceType = DEVICE_TYPE_TO_SOURCE_TYPE[dto.deviceType];
    }

    try {
      const updated = await this.prisma.attendanceDevice.update({ where: { id }, data });

      await this.auditService.record({
        actorUserId,
        entityType: 'AttendanceDevice',
        entityId: id,
        action: 'ATTENDANCE_DEVICE_UPDATED',
        beforeSnapshot: toJsonSnapshot(existing),
        afterSnapshot: toJsonSnapshot(updated),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('An attendance device with this code or serial number already exists');
      }
      throw error;
    }
  }

  async deactivate(id: string, actorUserId: string, context: RequestContext) {
    const existing = await this.findOne(id);
    if (!existing.isActive) {
      return existing;
    }

    const updated = await this.prisma.attendanceDevice.update({ where: { id }, data: { isActive: false } });

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendanceDevice',
      entityId: id,
      action: 'ATTENDANCE_DEVICE_DEACTIVATED',
      beforeSnapshot: toJsonSnapshot(existing),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }

  async testConnection(
    id: string,
    actorUserId: string,
    context: RequestContext,
  ): Promise<{ status: string; message: string }> {
    const device = await this.findOne(id);

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendanceDevice',
      entityId: device.id,
      action: 'ATTENDANCE_DEVICE_TEST_CONNECTION_ATTEMPTED',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      status: 'not_configured',
      message: 'Device connection testing is not implemented yet',
    };
  }
}
