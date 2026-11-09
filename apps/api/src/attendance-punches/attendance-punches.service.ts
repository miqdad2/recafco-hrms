import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceSourceType, PunchValidationStatus, type AttendanceRawPunch, type Prisma } from '@recafco/db';
import { setTimeout as sleep } from 'node:timers/promises';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { ClockService } from '../common/clock.service';
import { resolveEmployeeIdForUser } from '../common/current-employee.util';
import { dateRangeFilter } from '../common/date-range.util';
import { paginate, paginationSkip, type PaginatedResult } from '../common/pagination.util';
import { isUniqueConstraintError } from '../common/prisma-error.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import {
  CLIENT_CLOCK_SKEW_FLAG_SECONDS,
  IDEMPOTENT_RECOVERY_STALE_MS,
  IDEMPOTENT_REPLAY_WAIT_MS,
} from './attendance-validation.constants';
import { AttendanceValidationService } from './attendance-validation.service';
import { mobilePunchFingerprint } from './mobile-punch-fingerprint';
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

/** Flags added at intake (not by the validation engine) carry this source and survive re-validation. */
const INTAKE_FLAG_SOURCE = 'INTAKE';

export interface MobilePunchIntakeResult {
  punch: AttendanceRawPunch;
  /** true when this response is the stored result of an earlier request with the same clientRequestId. */
  replayed: boolean;
}

@Injectable()
export class AttendancePunchesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly attendanceValidationService: AttendanceValidationService,
    private readonly clock: ClockService,
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

  /**
   * Online mobile punch intake (TIME-01 contract).
   *
   * Official time: `receivedAt`, taken from the trusted server clock as the very first step, is
   * written to BOTH `punchTimeSource` (the field every downstream rule reads — validation,
   * duplicate window, Kuwait workDate, summary calculation) and `punchTimeServer`. The phone's
   * clock is kept only as `clientReportedTime` for diagnostics. If processing is ever moved to a
   * queue, the worker must use the stored `punchTimeServer`, never its own execution time.
   *
   * Idempotency: a `clientRequestId` is unique per (employee, MOBILE) at the database level. A
   * retry with the same id and the same validation-relevant payload returns the stored result;
   * the same id with a different payload is refused with 409.
   */
  async createMobile(dto: CreateMobilePunchDto, userId: string, context: RequestContext): Promise<MobilePunchIntakeResult> {
    const receivedAt = this.clock.now();
    const employeeId = await resolveEmployeeIdForUser(this.prisma, userId);
    const fingerprint = dto.clientRequestId ? mobilePunchFingerprint(dto) : null;

    if (dto.clientRequestId) {
      const existing = await this.findMobileByClientRequestId(employeeId, dto.clientRequestId);
      if (existing) {
        return this.replayMobileRequest(existing, fingerprint, userId, context);
      }
    }

    if (dto.workLocationId) {
      const workLocation = await this.prisma.workLocation.findUnique({ where: { id: dto.workLocationId } });
      if (!workLocation) {
        throw new BadRequestException('workLocationId does not reference an existing work location');
      }
    }

    // Resolved here purely to attach the FK (if a device row with this identifier exists at
    // all) — deciding whether it's approved, belongs to this employee, etc. is
    // AttendanceValidationService's job now, run immediately below, not duplicated here.
    const device = await this.prisma.mobileDevice.findUnique({ where: { deviceIdentifier: dto.deviceIdentifier } });

    const fraudFlags: Record<string, unknown>[] = [];
    if (dto.fraudSignals) {
      fraudFlags.push({ flag: 'CLIENT_REPORTED_SIGNALS', signals: dto.fraudSignals });
    }

    // Diagnostic client clock: new field first, legacy APK field as fallback. Neither can move
    // the official instant. Flags below carry source INTAKE so the validation engine (which
    // recomputes only its own VALIDATION_ENGINE flags) preserves them across re-validation.
    const submittedClientTime = dto.clientReportedTime ?? dto.punchTimeSource ?? null;
    const parsedClientTime = submittedClientTime ? new Date(submittedClientTime) : null;
    const clientReportedTime = parsedClientTime && !Number.isNaN(parsedClientTime.getTime()) ? parsedClientTime : null;
    if (submittedClientTime && !clientReportedTime) {
      fraudFlags.push({ source: INTAKE_FLAG_SOURCE, flag: 'CLIENT_TIME_UNPARSEABLE' });
    }
    if (clientReportedTime) {
      const skewSeconds = Math.round((clientReportedTime.getTime() - receivedAt.getTime()) / 1000);
      if (Math.abs(skewSeconds) > CLIENT_CLOCK_SKEW_FLAG_SECONDS) {
        fraudFlags.push({ source: INTAKE_FLAG_SOURCE, flag: 'CLIENT_CLOCK_SKEW', skewSeconds });
      }
    }
    if (!dto.clientRequestId) {
      // Informational: identifies traffic from pre-TIME-01 APKs (no retry idempotency).
      fraudFlags.push({ source: INTAKE_FLAG_SOURCE, flag: 'LEGACY_CLIENT_NO_REQUEST_ID' });
    }

    const data: Prisma.AttendanceRawPunchUncheckedCreateInput = {
      employeeId,
      punchType: dto.punchType,
      sourceType: AttendanceSourceType.MOBILE,
      punchTimeSource: receivedAt,
      punchTimeServer: receivedAt,
      clientReportedTime,
      clientRequestId: dto.clientRequestId ?? null,
      clientRequestFingerprint: fingerprint,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      gpsAccuracy: dto.gpsAccuracy ?? null,
      workLocationId: dto.workLocationId ?? null,
      mobileDeviceId: device?.id ?? null,
      ipAddress: context.ipAddress,
      wifiSsid: dto.wifiSsid ?? null,
      wifiBssid: dto.wifiBssid ?? null,
      selfieFileId: dto.selfieFileId ?? null,
      // A safe placeholder — overwritten by the automated validation decision below, in the
      // same request, before this response is returned.
      validationStatus: PunchValidationStatus.PENDING_HR_REVIEW,
      fraudScore: 0,
      fraudFlags: toJsonSnapshot(fraudFlags),
      rawPayload: toJsonSnapshot({
        appVersion: dto.appVersion ?? null,
        submittedDeviceIdentifier: dto.deviceIdentifier,
        // Exact string the client sent (including any UTC offset), for forensic review only.
        submittedClientTime,
        timeAuthority: 'SERVER_RECEIPT',
      }),
      isOfficial: false,
    };

    let punch: AttendanceRawPunch;
    try {
      punch = await this.prisma.attendanceRawPunch.create({ data });
    } catch (error) {
      // Lost a race against a simultaneous request carrying the same clientRequestId: the
      // database unique index decided the winner; this request becomes a replay of it.
      if (isUniqueConstraintError(error) && dto.clientRequestId) {
        const existing = await this.findMobileByClientRequestId(employeeId, dto.clientRequestId);
        if (existing) {
          return this.replayMobileRequest(existing, fingerprint, userId, context);
        }
      }
      throw error;
    }

    await this.auditService.record({
      actorUserId: userId,
      entityType: 'AttendanceRawPunch',
      entityId: punch.id,
      action: 'ATTENDANCE_PUNCH_MOBILE_CREATED',
      afterSnapshot: toJsonSnapshot(punch),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const { punch: processed } = await this.attendanceValidationService.processNewPunch(punch, userId, context);
    return { punch: processed, replayed: false };
  }

  private findMobileByClientRequestId(employeeId: string, clientRequestId: string) {
    return this.prisma.attendanceRawPunch.findUnique({
      where: {
        employeeId_sourceType_clientRequestId: {
          employeeId,
          sourceType: AttendanceSourceType.MOBILE,
          clientRequestId,
        },
      },
    });
  }

  /**
   * Handles a repeat of an already-stored clientRequestId. Never creates a second raw punch.
   *
   * - Different validation-relevant payload → 409 (conflicting reuse; nothing is stored).
   * - Original still being validated (concurrent duplicate) → wait briefly for it, then return it.
   * - Original stored but never validated and older than the stale threshold (the process died
   *   mid-request, the app never got a response) → resume processing for that same row.
   * - Otherwise → return the stored result exactly as it stands.
   */
  private async replayMobileRequest(
    existing: AttendanceRawPunch,
    fingerprint: string | null,
    userId: string,
    context: RequestContext,
  ): Promise<MobilePunchIntakeResult> {
    if (existing.clientRequestFingerprint !== fingerprint) {
      await this.auditService.record({
        actorUserId: userId,
        entityType: 'AttendanceRawPunch',
        entityId: existing.id,
        action: 'ATTENDANCE_PUNCH_MOBILE_REQUEST_ID_CONFLICT',
        afterSnapshot: toJsonSnapshot({ clientRequestId: existing.clientRequestId }),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'CLIENT_REQUEST_ID_REUSED',
        message: 'This punch request id was already used for a different punch. Start a new punch instead.',
      });
    }

    let current = existing;
    const waitUntil = Date.now() + IDEMPOTENT_REPLAY_WAIT_MS;
    while (current.validatedAt === null && Date.now() < waitUntil) {
      await sleep(100);
      current = await this.prisma.attendanceRawPunch.findUniqueOrThrow({ where: { id: current.id } });
    }

    if (
      current.validatedAt === null &&
      this.clock.now().getTime() - current.punchTimeServer.getTime() >= IDEMPOTENT_RECOVERY_STALE_MS
    ) {
      await this.auditService.record({
        actorUserId: userId,
        entityType: 'AttendanceRawPunch',
        entityId: current.id,
        action: 'ATTENDANCE_PUNCH_MOBILE_INTAKE_RESUMED',
        afterSnapshot: toJsonSnapshot(current),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      const { punch } = await this.attendanceValidationService.processNewPunch(current, userId, context);
      return { punch, replayed: true };
    }

    await this.auditService.record({
      actorUserId: userId,
      entityType: 'AttendanceRawPunch',
      entityId: current.id,
      action: 'ATTENDANCE_PUNCH_MOBILE_RETRY_REPLAYED',
      afterSnapshot: toJsonSnapshot({ clientRequestId: current.clientRequestId, validationStatus: current.validationStatus }),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return { punch: current, replayed: true };
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

      const { punch: processed } = await this.attendanceValidationService.processNewPunch(punch, actorUserId, context);
      return processed;
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

    // Never produces an ACCEPTED-family status for a directly-entered manual punch (see
    // AttendanceValidationService.validateManualPunch) — this only ever routes it to
    // PENDING_MANAGER_APPROVAL or REJECTED_POLICY_VIOLATION, both of which skip summary
    // recalculation. Manual punches become official only via the approved correction workflow.
    const { punch: processed } = await this.attendanceValidationService.processNewPunch(punch, actorUserId, context);
    return processed;
  }
}
