import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceSourceType, PunchValidationStatus, type Prisma } from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { resolveEmployeeIdForUser } from '../common/current-employee.util';
import { dateRangeFilter } from '../common/date-range.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { isUniqueConstraintError } from '../common/prisma-error.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { CreateDeviceImportPunchDto } from './dto/create-device-import-punch.dto';
import { CreateManualPunchDto } from './dto/create-manual-punch.dto';
import { CreateMobilePunchDto } from './dto/create-mobile-punch.dto';
import { ListAttendancePunchesQueryDto } from './dto/list-attendance-punches.query.dto';
import { ListMyAttendancePunchesQueryDto } from './dto/list-my-attendance-punches.query.dto';

const RELATIONS_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
  workLocation: { select: { id: true, name: true, code: true } },
  mobileDevice: { select: { id: true, deviceIdentifier: true, platform: true } },
  attendanceDevice: { select: { id: true, name: true, deviceCode: true } },
} satisfies Prisma.AttendanceRawPunchInclude;

@Injectable()
export class AttendancePunchesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async findAll(query: ListAttendancePunchesQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.AttendanceRawPunchWhereInput = {};
    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }
    if (query.workLocationId) {
      where.workLocationId = query.workLocationId;
    }
    if (query.sourceType) {
      where.sourceType = query.sourceType;
    }
    if (query.punchType) {
      where.punchType = query.punchType;
    }
    if (query.validationStatus) {
      where.validationStatus = query.validationStatus;
    }
    const punchTimeServer = dateRangeFilter(query.from, query.to);
    if (punchTimeServer) {
      where.punchTimeServer = punchTimeServer;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceRawPunch.findMany({
        where,
        include: RELATIONS_INCLUDE,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { punchTimeServer: 'desc' },
      }),
      this.prisma.attendanceRawPunch.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const punch = await this.prisma.attendanceRawPunch.findUnique({ where: { id }, include: RELATIONS_INCLUDE });
    if (!punch) {
      throw new NotFoundException('Attendance raw punch not found');
    }
    return punch;
  }

  async findMine(userId: string, query: ListMyAttendancePunchesQueryDto): Promise<PaginatedResult<unknown>> {
    const employeeId = await resolveEmployeeIdForUser(this.prisma, userId);

    const where: Prisma.AttendanceRawPunchWhereInput = { employeeId };
    const punchTimeServer = dateRangeFilter(query.from, query.to);
    if (punchTimeServer) {
      where.punchTimeServer = punchTimeServer;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceRawPunch.findMany({
        where,
        skip: paginationSkip(query.page, query.limit),
        take: query.limit,
        orderBy: { punchTimeServer: 'desc' },
      }),
      this.prisma.attendanceRawPunch.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async createMobile(dto: CreateMobilePunchDto, userId: string, context: RequestContext) {
    const employeeId = await resolveEmployeeIdForUser(this.prisma, userId);

    if (dto.workLocationId) {
      const workLocation = await this.prisma.workLocation.findUnique({ where: { id: dto.workLocationId } });
      if (!workLocation) {
        throw new BadRequestException('workLocationId does not reference an existing work location');
      }
    }

    const device = await this.prisma.mobileDevice.findUnique({ where: { deviceIdentifier: dto.deviceIdentifier } });

    const fraudFlags: Record<string, unknown>[] = [];
    let validationStatus: PunchValidationStatus;
    let mobileDeviceId: string | null = null;

    if (!device) {
      validationStatus = PunchValidationStatus.REJECTED_UNREGISTERED_DEVICE;
      fraudFlags.push({ flag: 'DEVICE_NOT_REGISTERED', deviceIdentifier: dto.deviceIdentifier });
    } else if (device.employeeId !== employeeId) {
      validationStatus = PunchValidationStatus.REJECTED_UNREGISTERED_DEVICE;
      fraudFlags.push({ flag: 'DEVICE_BELONGS_TO_DIFFERENT_EMPLOYEE', deviceIdentifier: dto.deviceIdentifier });
    } else if (device.status !== 'APPROVED') {
      validationStatus = PunchValidationStatus.REJECTED_UNREGISTERED_DEVICE;
      mobileDeviceId = device.id;
      fraudFlags.push({ flag: 'DEVICE_NOT_APPROVED', deviceStatus: device.status });
    } else {
      validationStatus = PunchValidationStatus.PENDING_HR_REVIEW;
      mobileDeviceId = device.id;
    }

    if (dto.fraudSignals) {
      fraudFlags.push({ flag: 'CLIENT_REPORTED_SIGNALS', signals: dto.fraudSignals });
    }

    const data: Prisma.AttendanceRawPunchUncheckedCreateInput = {
      employeeId,
      punchType: dto.punchType,
      sourceType: AttendanceSourceType.MOBILE,
      punchTimeSource: new Date(dto.punchTimeSource),
      punchTimeServer: new Date(),
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      gpsAccuracy: dto.gpsAccuracy ?? null,
      workLocationId: dto.workLocationId ?? null,
      mobileDeviceId,
      ipAddress: context.ipAddress,
      wifiSsid: dto.wifiSsid ?? null,
      wifiBssid: dto.wifiBssid ?? null,
      selfieFileId: dto.selfieFileId ?? null,
      validationStatus,
      fraudScore: 0,
      fraudFlags: toJsonSnapshot(fraudFlags),
      rawPayload: toJsonSnapshot({
        appVersion: dto.appVersion ?? null,
        submittedDeviceIdentifier: dto.deviceIdentifier,
      }),
      isOfficial: false,
    };

    const punch = await this.prisma.attendanceRawPunch.create({ data });

    await this.auditService.record({
      actorUserId: userId,
      entityType: 'AttendanceRawPunch',
      entityId: punch.id,
      action: 'ATTENDANCE_PUNCH_MOBILE_CREATED',
      afterSnapshot: toJsonSnapshot(punch),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return punch;
  }

  async createDeviceImport(dto: CreateDeviceImportPunchDto, actorUserId: string, context: RequestContext) {
    const device = await this.prisma.attendanceDevice.findUnique({ where: { id: dto.attendanceDeviceId } });
    if (!device) {
      throw new BadRequestException('attendanceDeviceId does not reference an existing attendance device');
    }
    if (!device.isActive) {
      throw new BadRequestException('attendanceDeviceId must reference an active attendance device');
    }

    const employee = await this.prisma.employee.findUnique({ where: { employeeCode: dto.employeeCode } });
    if (!employee) {
      throw new BadRequestException('employeeCode does not reference an existing employee');
    }

    if (dto.sourceId) {
      const existing = await this.prisma.attendanceRawPunch.findFirst({
        where: { attendanceDeviceId: dto.attendanceDeviceId, sourceId: dto.sourceId },
      });
      if (existing) {
        return existing;
      }
    }

    const data: Prisma.AttendanceRawPunchUncheckedCreateInput = {
      employeeId: employee.id,
      punchType: dto.punchType,
      sourceType: device.sourceType,
      sourceId: dto.sourceId ?? null,
      punchTimeSource: new Date(dto.punchTimeSource),
      punchTimeServer: new Date(),
      workLocationId: device.workLocationId,
      attendanceDeviceId: device.id,
      validationStatus: PunchValidationStatus.PENDING_HR_REVIEW,
      fraudScore: 0,
      fraudFlags: toJsonSnapshot([]),
      rawPayload: toJsonSnapshot({ employeeCode: dto.employeeCode, importedVia: 'device-import-api' }),
      isOfficial: false,
    };

    try {
      const punch = await this.prisma.attendanceRawPunch.create({ data });

      await this.auditService.record({
        actorUserId,
        entityType: 'AttendanceRawPunch',
        entityId: punch.id,
        action: 'ATTENDANCE_PUNCH_DEVICE_IMPORT_CREATED',
        afterSnapshot: toJsonSnapshot(punch),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return punch;
    } catch (error) {
      if (isUniqueConstraintError(error) && dto.sourceId) {
        const existing = await this.prisma.attendanceRawPunch.findFirst({
          where: { attendanceDeviceId: dto.attendanceDeviceId, sourceId: dto.sourceId },
        });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async createManual(dto: CreateManualPunchDto, actorUserId: string, context: RequestContext) {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new BadRequestException('employeeId does not reference an existing employee');
    }

    const data: Prisma.AttendanceRawPunchUncheckedCreateInput = {
      employeeId: dto.employeeId,
      punchType: dto.punchType,
      sourceType: AttendanceSourceType.MANUAL_CORRECTION,
      punchTimeSource: new Date(dto.punchTimeSource),
      punchTimeServer: new Date(),
      validationStatus: PunchValidationStatus.PENDING_HR_REVIEW,
      fraudScore: 0,
      fraudFlags: toJsonSnapshot([]),
      rawPayload: toJsonSnapshot({ reason: dto.reason, enteredByUserId: actorUserId }),
      isOfficial: false,
    };

    const punch = await this.prisma.attendanceRawPunch.create({ data });

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendanceRawPunch',
      entityId: punch.id,
      action: 'ATTENDANCE_PUNCH_MANUAL_CREATED',
      afterSnapshot: toJsonSnapshot(punch),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return punch;
  }
}
