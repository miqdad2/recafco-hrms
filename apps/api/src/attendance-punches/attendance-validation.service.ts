import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceSourceType,
  EmployeeStatus,
  MobileDeviceStatus,
  PunchValidationStatus,
  type AttendanceRawPunch,
  type Prisma,
  type WorkLocation,
} from '@recafco/db';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { dateRangeFilter } from '../common/date-range.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { ValidatePendingDto } from './dto/validate-pending.dto';

/**
 * A punch is treated as a duplicate of another if they share employee/punchType/sourceType
 * and either the same sourceId, or (when no sourceId is available, e.g. mobile/manual punches)
 * their source-reported timestamps fall within this window of each other.
 */
const DUPLICATE_TIME_WINDOW_MINUTES = 2;

/** Above this accuracy radius (meters), a mobile GPS fix is treated as too weak to trust outright. */
const GPS_ACCURACY_POOR_THRESHOLD_METERS = 50;

const ENGINE_FLAG_SOURCE = 'VALIDATION_ENGINE';

/**
 * Deterministic point weights for fraudScore. These are additive and recomputed from scratch on
 * every validation run (fraudScore reflects current-facts risk, not a historical running total).
 */
const FRAUD_WEIGHTS = {
  EMPLOYEE_INACTIVE: 100,
  DUPLICATE_PUNCH: 80,
  UNAPPROVED_DEVICE: 80,
  FAKE_GPS_SIGNAL: 90,
  OUTSIDE_GEOFENCE: 70,
  INACTIVE_WORK_LOCATION: 40,
  POOR_GPS_ACCURACY: 30,
  MISSING_LOCATION_DATA: 20,
  MOBILE_PUNCHING_NOT_ALLOWED: 50,
  MISSING_MANUAL_REASON: 50,
} as const;

/**
 * Outcomes ranked worst-to-best. When a single validation pass surfaces multiple candidate
 * statuses (e.g. poor GPS accuracy AND outside geofence), the most severe one wins, while
 * fraudScore/fraudFlags still accumulate every condition that was found.
 */
const STATUS_SEVERITY: Record<PunchValidationStatus, number> = {
  [PunchValidationStatus.REJECTED_EMPLOYEE_INACTIVE]: 100,
  [PunchValidationStatus.REJECTED_DUPLICATE]: 95,
  [PunchValidationStatus.REJECTED_UNREGISTERED_DEVICE]: 90,
  [PunchValidationStatus.REJECTED_FAKE_GPS]: 85,
  [PunchValidationStatus.REJECTED_OUTSIDE_LOCATION]: 80,
  [PunchValidationStatus.REJECTED_POLICY_VIOLATION]: 75,
  [PunchValidationStatus.PENDING_MANAGER_APPROVAL]: 50,
  [PunchValidationStatus.PENDING_HR_REVIEW]: 40,
  [PunchValidationStatus.ACCEPTED_WITH_WARNING]: 10,
  [PunchValidationStatus.ACCEPTED]: 0,
};

interface SourceValidationResult {
  statusCandidates: PunchValidationStatus[];
  fraudScoreDelta: number;
  fraudFlags: Record<string, unknown>[];
  distanceFromLocationMeters?: number;
}

interface ValidationComputation {
  validationStatus: PunchValidationStatus;
  fraudScore: number;
  fraudFlags: Record<string, unknown>[];
  distanceFromLocationMeters?: number;
  duplicateOfPunchId?: string;
}

interface ValidatePendingSummary {
  totalProcessed: number;
  accepted: number;
  rejected: number;
  pending: number;
}

@Injectable()
export class AttendanceValidationService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async validatePunch(punchId: string, actorUserId: string, context: RequestContext): Promise<AttendanceRawPunch> {
    const punch = await this.prisma.attendanceRawPunch.findUnique({ where: { id: punchId } });
    if (!punch) {
      throw new NotFoundException('Attendance raw punch not found');
    }

    const updated = await this.computeAndApplyValidation(punch, actorUserId);

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendanceRawPunch',
      entityId: punch.id,
      action: 'ATTENDANCE_PUNCH_VALIDATED',
      beforeSnapshot: toJsonSnapshot(punch),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return updated;
  }

  async validatePending(
    dto: ValidatePendingDto,
    actorUserId: string,
    context: RequestContext,
  ): Promise<ValidatePendingSummary> {
    const limit = dto.limit ?? 20;
    const where: Prisma.AttendanceRawPunchWhereInput = {
      validationStatus: {
        in: [PunchValidationStatus.PENDING_HR_REVIEW, PunchValidationStatus.PENDING_MANAGER_APPROVAL],
      },
    };
    if (dto.employeeId) {
      where.employeeId = dto.employeeId;
    }
    const punchTimeServer = dateRangeFilter(dto.from, dto.to);
    if (punchTimeServer) {
      where.punchTimeServer = punchTimeServer;
    }

    const pending = await this.prisma.attendanceRawPunch.findMany({
      where,
      take: limit,
      orderBy: { punchTimeServer: 'asc' },
    });

    const summary: ValidatePendingSummary = { totalProcessed: pending.length, accepted: 0, rejected: 0, pending: 0 };
    const processedPunchIds: string[] = [];

    for (const punch of pending) {
      const updated = await this.computeAndApplyValidation(punch, actorUserId);
      processedPunchIds.push(updated.id);
      if (updated.validationStatus.startsWith('ACCEPTED')) {
        summary.accepted += 1;
      } else if (updated.validationStatus.startsWith('REJECTED')) {
        summary.rejected += 1;
      } else {
        summary.pending += 1;
      }
    }

    await this.auditService.record({
      actorUserId,
      entityType: 'AttendanceRawPunch',
      entityId: `batch-${new Date().toISOString()}`,
      action: 'ATTENDANCE_PUNCH_BATCH_VALIDATED',
      afterSnapshot: toJsonSnapshot({ filters: dto, summary, processedPunchIds }),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return summary;
  }

  private async computeAndApplyValidation(punch: AttendanceRawPunch, actorUserId?: string): Promise<AttendanceRawPunch> {
    const result = await this.computeValidationResult(punch);

    const data: Prisma.AttendanceRawPunchUncheckedUpdateInput = {
      validationStatus: result.validationStatus,
      fraudScore: result.fraudScore,
      fraudFlags: toJsonSnapshot(result.fraudFlags),
      isOfficial: false,
      validatedAt: new Date(),
      validatedByUserId: actorUserId ?? null,
    };
    if (result.distanceFromLocationMeters !== undefined) {
      data.distanceFromLocationMeters = result.distanceFromLocationMeters;
    }
    if (result.duplicateOfPunchId !== undefined) {
      data.duplicateOfPunchId = result.duplicateOfPunchId;
    }

    return this.prisma.attendanceRawPunch.update({ where: { id: punch.id }, data });
  }

  private async computeValidationResult(punch: AttendanceRawPunch): Promise<ValidationComputation> {
    const preservedFlags = this.extractNonEngineFlags(punch.fraudFlags);

    const employee = await this.prisma.employee.findUnique({ where: { id: punch.employeeId } });
    if (!employee || employee.status !== EmployeeStatus.ACTIVE) {
      const flags = [...preservedFlags];
      this.pushFlag(flags, 'EMPLOYEE_INACTIVE', { employeeStatus: employee?.status ?? 'NOT_FOUND' });
      return {
        validationStatus: PunchValidationStatus.REJECTED_EMPLOYEE_INACTIVE,
        fraudScore: FRAUD_WEIGHTS.EMPLOYEE_INACTIVE,
        fraudFlags: flags,
      };
    }

    const duplicateOriginal = await this.resolveDuplicateOriginal(punch);
    if (duplicateOriginal) {
      const flags = [...preservedFlags];
      this.pushFlag(flags, 'DUPLICATE_PUNCH', { duplicateOfPunchId: duplicateOriginal.id });
      return {
        validationStatus: PunchValidationStatus.REJECTED_DUPLICATE,
        fraudScore: FRAUD_WEIGHTS.DUPLICATE_PUNCH,
        fraudFlags: flags,
        duplicateOfPunchId: duplicateOriginal.id,
      };
    }

    let sourceResult: SourceValidationResult;
    if (punch.sourceType === AttendanceSourceType.MANUAL_CORRECTION) {
      sourceResult = this.validateManualPunch(punch);
    } else if (punch.sourceType === AttendanceSourceType.MOBILE) {
      sourceResult = await this.validateMobilePunch(punch, employee.isMobilePunchAllowed, employee.isDeviceOnly);
    } else {
      sourceResult = await this.validateDevicePunch(punch);
    }

    const computation: ValidationComputation = {
      validationStatus: this.pickMostSevere(sourceResult.statusCandidates),
      fraudScore: sourceResult.fraudScoreDelta,
      fraudFlags: [...preservedFlags, ...sourceResult.fraudFlags],
    };
    if (sourceResult.distanceFromLocationMeters !== undefined) {
      computation.distanceFromLocationMeters = sourceResult.distanceFromLocationMeters;
    }
    return computation;
  }

  private async validateMobilePunch(
    punch: AttendanceRawPunch,
    isMobilePunchAllowed: boolean,
    isDeviceOnly: boolean,
  ): Promise<SourceValidationResult> {
    const flags: Record<string, unknown>[] = [];

    if (!isMobilePunchAllowed || isDeviceOnly) {
      this.pushFlag(flags, 'MOBILE_PUNCHING_NOT_ALLOWED', { isMobilePunchAllowed, isDeviceOnly });
      return {
        statusCandidates: [PunchValidationStatus.REJECTED_POLICY_VIOLATION],
        fraudScoreDelta: FRAUD_WEIGHTS.MOBILE_PUNCHING_NOT_ALLOWED,
        fraudFlags: flags,
      };
    }

    if (!punch.mobileDeviceId) {
      this.pushFlag(flags, 'DEVICE_NOT_REGISTERED');
      return {
        statusCandidates: [PunchValidationStatus.REJECTED_UNREGISTERED_DEVICE],
        fraudScoreDelta: FRAUD_WEIGHTS.UNAPPROVED_DEVICE,
        fraudFlags: flags,
      };
    }

    const device = await this.prisma.mobileDevice.findUnique({ where: { id: punch.mobileDeviceId } });
    if (!device || device.employeeId !== punch.employeeId) {
      this.pushFlag(flags, 'DEVICE_BELONGS_TO_DIFFERENT_EMPLOYEE_OR_MISSING');
      return {
        statusCandidates: [PunchValidationStatus.REJECTED_UNREGISTERED_DEVICE],
        fraudScoreDelta: FRAUD_WEIGHTS.UNAPPROVED_DEVICE,
        fraudFlags: flags,
      };
    }
    if (device.status !== MobileDeviceStatus.APPROVED) {
      this.pushFlag(flags, 'DEVICE_NOT_APPROVED', { deviceStatus: device.status });
      return {
        statusCandidates: [PunchValidationStatus.REJECTED_UNREGISTERED_DEVICE],
        fraudScoreDelta: FRAUD_WEIGHTS.UNAPPROVED_DEVICE,
        fraudFlags: flags,
      };
    }

    const statusCandidates: PunchValidationStatus[] = [];
    let fraudScoreDelta = 0;
    let distanceFromLocationMeters: number | undefined;
    let workLocation: WorkLocation | null = null;

    if (punch.workLocationId) {
      workLocation = await this.prisma.workLocation.findUnique({ where: { id: punch.workLocationId } });
      if (!workLocation || !workLocation.isActive) {
        this.pushFlag(flags, 'WORK_LOCATION_INACTIVE');
        fraudScoreDelta += FRAUD_WEIGHTS.INACTIVE_WORK_LOCATION;
        statusCandidates.push(PunchValidationStatus.REJECTED_POLICY_VIOLATION);
        workLocation = null;
      }
    }

    if (punch.latitude == null || punch.longitude == null) {
      this.pushFlag(flags, 'MISSING_LOCATION_DATA');
      fraudScoreDelta += FRAUD_WEIGHTS.MISSING_LOCATION_DATA;
      statusCandidates.push(PunchValidationStatus.PENDING_HR_REVIEW);
    } else if (workLocation) {
      const distance = calculateDistanceMeters(punch.latitude, punch.longitude, workLocation.latitude, workLocation.longitude);
      distanceFromLocationMeters = distance;
      if (distance > workLocation.geofenceRadiusMeters) {
        this.pushFlag(flags, 'OUTSIDE_GEOFENCE', {
          distanceMeters: Math.round(distance),
          allowedRadiusMeters: workLocation.geofenceRadiusMeters,
        });
        fraudScoreDelta += FRAUD_WEIGHTS.OUTSIDE_GEOFENCE;
        statusCandidates.push(PunchValidationStatus.REJECTED_OUTSIDE_LOCATION);
      }
    }

    if (punch.gpsAccuracy != null && punch.gpsAccuracy > GPS_ACCURACY_POOR_THRESHOLD_METERS) {
      this.pushFlag(flags, 'GPS_ACCURACY_POOR', { gpsAccuracy: punch.gpsAccuracy });
      fraudScoreDelta += FRAUD_WEIGHTS.POOR_GPS_ACCURACY;
      statusCandidates.push(PunchValidationStatus.PENDING_HR_REVIEW);
    }

    if (this.hasFraudSignal(punch.fraudFlags)) {
      this.pushFlag(flags, 'CLIENT_SIGNAL_FAKE_GPS_OR_ROOT');
      fraudScoreDelta += FRAUD_WEIGHTS.FAKE_GPS_SIGNAL;
      statusCandidates.push(PunchValidationStatus.REJECTED_FAKE_GPS);
    }

    if (statusCandidates.length === 0) {
      statusCandidates.push(PunchValidationStatus.ACCEPTED_WITH_WARNING);
    }

    const result: SourceValidationResult = { statusCandidates, fraudScoreDelta, fraudFlags: flags };
    if (distanceFromLocationMeters !== undefined) {
      result.distanceFromLocationMeters = distanceFromLocationMeters;
    }
    return result;
  }

  private async validateDevicePunch(punch: AttendanceRawPunch): Promise<SourceValidationResult> {
    const flags: Record<string, unknown>[] = [];

    if (!punch.attendanceDeviceId) {
      this.pushFlag(flags, 'UNRECOGNIZED_SOURCE_NO_DEVICE');
      return { statusCandidates: [PunchValidationStatus.PENDING_HR_REVIEW], fraudScoreDelta: 0, fraudFlags: flags };
    }

    const device = await this.prisma.attendanceDevice.findUnique({ where: { id: punch.attendanceDeviceId } });
    if (!device || !device.isActive) {
      this.pushFlag(flags, 'ATTENDANCE_DEVICE_INACTIVE_OR_MISSING');
      return {
        statusCandidates: [PunchValidationStatus.REJECTED_UNREGISTERED_DEVICE],
        fraudScoreDelta: FRAUD_WEIGHTS.UNAPPROVED_DEVICE,
        fraudFlags: flags,
      };
    }

    const statusCandidates: PunchValidationStatus[] = [];
    let fraudScoreDelta = 0;

    const workLocation = await this.prisma.workLocation.findUnique({ where: { id: device.workLocationId } });
    if (!workLocation || !workLocation.isActive) {
      this.pushFlag(flags, 'WORK_LOCATION_INACTIVE');
      fraudScoreDelta += FRAUD_WEIGHTS.INACTIVE_WORK_LOCATION;
      statusCandidates.push(PunchValidationStatus.REJECTED_POLICY_VIOLATION);
    }

    if (statusCandidates.length === 0) {
      statusCandidates.push(PunchValidationStatus.ACCEPTED_WITH_WARNING);
    }

    return { statusCandidates, fraudScoreDelta, fraudFlags: flags };
  }

  private validateManualPunch(punch: AttendanceRawPunch): SourceValidationResult {
    const flags: Record<string, unknown>[] = [];
    const rawPayload = (punch.rawPayload && typeof punch.rawPayload === 'object' ? punch.rawPayload : {}) as Record<
      string,
      unknown
    >;
    const reason = rawPayload.reason;

    if (typeof reason !== 'string' || reason.trim().length === 0) {
      this.pushFlag(flags, 'MISSING_REASON');
      return {
        statusCandidates: [PunchValidationStatus.REJECTED_POLICY_VIOLATION],
        fraudScoreDelta: FRAUD_WEIGHTS.MISSING_MANUAL_REASON,
        fraudFlags: flags,
      };
    }

    // Manual punches always require human sign-off in this unit — never auto-accepted.
    return {
      statusCandidates: [PunchValidationStatus.PENDING_MANAGER_APPROVAL],
      fraudScoreDelta: 0,
      fraudFlags: flags,
    };
  }

  private async resolveDuplicateOriginal(punch: AttendanceRawPunch): Promise<AttendanceRawPunch | null> {
    if (punch.duplicateOfPunchId) {
      return this.prisma.attendanceRawPunch.findUnique({ where: { id: punch.duplicateOfPunchId } });
    }

    const windowMs = DUPLICATE_TIME_WINDOW_MINUTES * 60_000;
    const windowStart = new Date(punch.punchTimeSource.getTime() - windowMs);
    const windowEnd = new Date(punch.punchTimeSource.getTime() + windowMs);

    const orConditions: Prisma.AttendanceRawPunchWhereInput[] = [
      { punchTimeSource: { gte: windowStart, lte: windowEnd } },
    ];
    if (punch.sourceId) {
      orConditions.push({ sourceId: punch.sourceId });
    }

    const candidates = await this.prisma.attendanceRawPunch.findMany({
      where: {
        id: { not: punch.id },
        employeeId: punch.employeeId,
        punchType: punch.punchType,
        sourceType: punch.sourceType,
        createdAt: { lt: punch.createdAt },
        OR: orConditions,
      },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });

    return candidates[0] ?? null;
  }

  private hasFraudSignal(fraudFlagsJson: Prisma.JsonValue): boolean {
    const suspiciousKeys = ['mocklocation', 'fakegps', 'isrooted', 'isjailbroken', 'rooted', 'jailbroken'];
    for (const entry of this.toFlagArray(fraudFlagsJson)) {
      if (entry.flag !== 'CLIENT_REPORTED_SIGNALS') {
        continue;
      }
      const signals = entry.signals;
      if (signals && typeof signals === 'object') {
        for (const [key, value] of Object.entries(signals as Record<string, unknown>)) {
          if (suspiciousKeys.includes(key.toLowerCase()) && value === true) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private extractNonEngineFlags(existing: Prisma.JsonValue): Record<string, unknown>[] {
    return this.toFlagArray(existing).filter((flag) => flag.source !== ENGINE_FLAG_SOURCE);
  }

  private toFlagArray(json: Prisma.JsonValue): Record<string, unknown>[] {
    if (!Array.isArray(json)) {
      return [];
    }
    const items = json as unknown[];
    return items.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }

  private pushFlag(flags: Record<string, unknown>[], flag: string, details?: Record<string, unknown>): void {
    flags.push({ source: ENGINE_FLAG_SOURCE, flag, ...(details ?? {}) });
  }

  private pickMostSevere(candidates: PunchValidationStatus[]): PunchValidationStatus {
    return candidates.reduce((worst, candidate) =>
      STATUS_SEVERITY[candidate] > STATUS_SEVERITY[worst] ? candidate : worst,
    );
  }
}

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusMeters = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}
