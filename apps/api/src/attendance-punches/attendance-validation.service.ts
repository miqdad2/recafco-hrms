import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceSourceType,
  EmployeeStatus,
  MobileDeviceStatus,
  PunchValidationStatus,
  type AttendanceDailySummary,
  type AttendanceRawPunch,
  type Prisma,
  type WorkLocation,
} from '@recafco/db';
import { AttendanceSummaryCalculatorService } from '../attendance-summaries/attendance-summary-calculator.service';
import { toKuwaitWorkDate } from '../attendance-summaries/kuwait-date.util';
import { AuditService } from '../audit/audit.service';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import { dateRangeFilter } from '../common/date-range.util';
import { PayrollLockGuardService } from '../payroll-locks/payroll-lock-guard.service';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { DUPLICATE_WINDOW_MINUTES, MOBILE_GPS_ACCURACY_MAX_METERS } from './attendance-validation.constants';
import { ValidatePendingDto } from './dto/validate-pending.dto';

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
  /** Kept for backward compatibility with the existing admin web screen — do not rename. */
  totalProcessed: number;
  accepted: number;
  rejected: number;
  pending: number;
  /** New in Unit 20.1. */
  summariesRecalculated: number;
  skippedLocked: number;
}

interface PunchProcessingResult {
  punch: AttendanceRawPunch;
  summary: AttendanceDailySummary | null;
  skippedLocked: boolean;
}

@Injectable()
export class AttendanceValidationService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly attendanceSummaryCalculatorService: AttendanceSummaryCalculatorService,
    private readonly payrollLockGuardService: PayrollLockGuardService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  /**
   * The automated path: called immediately after a mobile/device-import/manual raw punch is
   * created (same request, no background job). Runs the same deterministic rule engine
   * `validatePunch` uses, but records it under the new "AUTO_*" audit vocabulary (actorUserId
   * `null` — no human reviewed this row, the engine decided it) and, if accepted, immediately
   * recalculates the employee's daily summary.
   */
  async processNewPunch(
    punch: AttendanceRawPunch,
    requestActorUserId: string,
    context: RequestContext,
  ): Promise<PunchProcessingResult> {
    const before = punch;
    const updated = await this.computeAndApplyValidation(punch, undefined);

    const action = updated.validationStatus.startsWith('ACCEPTED')
      ? 'ATTENDANCE_PUNCH_AUTO_VALIDATED'
      : updated.validationStatus.startsWith('REJECTED')
        ? 'ATTENDANCE_PUNCH_AUTO_REJECTED'
        : 'ATTENDANCE_PUNCH_SENT_TO_REVIEW';

    await this.auditService.record({
      actorUserId: null,
      entityType: 'AttendanceRawPunch',
      entityId: updated.id,
      action,
      beforeSnapshot: toJsonSnapshot(before),
      afterSnapshot: toJsonSnapshot(updated),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const { summary, skippedLocked } = await this.recalculateIfAccepted(
      updated,
      requestActorUserId,
      context,
      /* automated */ true,
    );

    // recalculateIfAccepted mutates this punch row after `updated` was captured above — either
    // the summary calculator flips `isOfficial` on the winning IN/OUT punch in its own
    // transaction, or (when the date is locked) flagLockedPeriodPunch appends
    // LOCKED_PERIOD_LATE_PUNCH to fraudFlags. Re-fetch in either case so the response accurately
    // reflects the punch's final state rather than the pre-recalculation snapshot.
    const finalPunch = summary || skippedLocked ? await this.refetchPunch(updated.id) : updated;

    return { punch: finalPunch, summary, skippedLocked };
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

    const { summary, skippedLocked } = await this.recalculateIfAccepted(
      updated,
      actorUserId,
      context,
      /* automated */ false,
    );

    return summary || skippedLocked ? await this.refetchPunch(updated.id) : updated;
  }

  private async refetchPunch(punchId: string): Promise<AttendanceRawPunch> {
    const punch = await this.prisma.attendanceRawPunch.findUniqueOrThrow({ where: { id: punchId } });
    return punch;
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

    const summary: ValidatePendingSummary = {
      totalProcessed: pending.length,
      accepted: 0,
      rejected: 0,
      pending: 0,
      summariesRecalculated: 0,
      skippedLocked: 0,
    };
    const processedPunchIds: string[] = [];

    for (const punch of pending) {
      const updated = await this.computeAndApplyValidation(punch, actorUserId);
      processedPunchIds.push(updated.id);
      if (updated.validationStatus.startsWith('ACCEPTED')) {
        summary.accepted += 1;
        const { summary: recalculated, skippedLocked } = await this.recalculateIfAccepted(
          updated,
          actorUserId,
          context,
          /* automated */ true,
        );
        if (recalculated) {
          summary.summariesRecalculated += 1;
        }
        if (skippedLocked) {
          summary.skippedLocked += 1;
        }
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

  /**
   * Shared by every call site that can produce a freshly-ACCEPTED/ACCEPTED_WITH_WARNING punch
   * (auto-creation, single validate, batch validate-pending): recalculates the employee's daily
   * summary for the punch's Kuwait workDate, unless that date falls inside a LOCKED payroll
   * period — in which case the punch is left exactly as validated (still ACCEPTED, still stored
   * as evidence) but the summary/official flags are never touched, and a LOCKED_PERIOD_LATE_PUNCH
   * flag is added so HR's exception view can find it later.
   */
  private async recalculateIfAccepted(
    punch: AttendanceRawPunch,
    requestActorUserId: string,
    context: RequestContext,
    automated: boolean,
  ): Promise<{ summary: AttendanceDailySummary | null; skippedLocked: boolean }> {
    if (!punch.validationStatus.startsWith('ACCEPTED')) {
      return { summary: null, skippedLocked: false };
    }

    const workDate = toKuwaitWorkDate(punch.punchTimeSource);
    const isLocked = await this.payrollLockGuardService.isDateInLockedPeriod(workDate);
    if (isLocked) {
      await this.flagLockedPeriodPunch(punch);
      return { summary: null, skippedLocked: true };
    }

    try {
      const recalculatedSummary = await this.attendanceSummaryCalculatorService.calculateForEmployeeDate(
        punch.employeeId,
        workDate.toISOString(),
        requestActorUserId,
        context,
      );

      await this.auditService.record({
        actorUserId: automated ? null : requestActorUserId,
        entityType: 'AttendanceDailySummary',
        entityId: recalculatedSummary.id,
        action: 'ATTENDANCE_SUMMARY_AUTO_RECALCULATED',
        afterSnapshot: toJsonSnapshot({ summary: recalculatedSummary, triggeredByPunchId: punch.id, automated }),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return { summary: recalculatedSummary, skippedLocked: false };
    } catch (error) {
      if (error instanceof ConflictException) {
        await this.flagLockedPeriodPunch(punch);
        return { summary: null, skippedLocked: true };
      }
      throw error;
    }
  }

  private async flagLockedPeriodPunch(punch: AttendanceRawPunch): Promise<void> {
    const flags = this.toFlagArray(punch.fraudFlags);
    if (flags.some((flag) => flag.flag === 'LOCKED_PERIOD_LATE_PUNCH')) {
      return;
    }
    this.pushFlag(flags, 'LOCKED_PERIOD_LATE_PUNCH');
    await this.prisma.attendanceRawPunch.update({
      where: { id: punch.id },
      data: { fraudFlags: toJsonSnapshot(flags) },
    });
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
      sourceResult = await this.validateMobilePunch(
        punch,
        employee.isMobilePunchAllowed,
        employee.isDeviceOnly,
        employee.workLocationId,
      );
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
    employeeDefaultWorkLocationId: string | null,
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
      // Distinct flags per status — not strictly needed to pick the (single) resulting
      // PunchValidationStatus, but the exact reason matters a lot for a future HR exception
      // dashboard trying to tell "never approved yet" apart from "was approved, then blocked".
      const deviceFlag =
        device.status === MobileDeviceStatus.BLOCKED
          ? 'DEVICE_BLOCKED'
          : device.status === MobileDeviceStatus.DEACTIVATED
            ? 'DEVICE_DEACTIVATED'
            : 'DEVICE_NOT_APPROVED';
      this.pushFlag(flags, deviceFlag, { deviceStatus: device.status });
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

    // Option B (preferred, per Unit 20.1's own decision): the mobile app does not currently
    // send `workLocationId` on every punch (Unit 17 scoped that out), so falling back to the
    // employee's own assigned `workLocationId` is what actually makes geofence checking happen
    // for real mobile punches at all, rather than silently skipping it whenever the client
    // didn't supply one.
    let resolvedWorkLocationId = punch.workLocationId;
    let workLocationWasInferred = false;
    if (!resolvedWorkLocationId && employeeDefaultWorkLocationId) {
      resolvedWorkLocationId = employeeDefaultWorkLocationId;
      workLocationWasInferred = true;
    }

    if (resolvedWorkLocationId) {
      workLocation = await this.prisma.workLocation.findUnique({ where: { id: resolvedWorkLocationId } });
      if (!workLocation || !workLocation.isActive) {
        this.pushFlag(flags, 'WORK_LOCATION_INACTIVE');
        fraudScoreDelta += FRAUD_WEIGHTS.INACTIVE_WORK_LOCATION;
        statusCandidates.push(PunchValidationStatus.REJECTED_POLICY_VIOLATION);
        workLocation = null;
      } else if (workLocationWasInferred) {
        // Informational only — not a blocking condition, just useful context for review.
        this.pushFlag(flags, 'WORK_LOCATION_INFERRED_FROM_EMPLOYEE_DEFAULT', { workLocationId: resolvedWorkLocationId });
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
    } else if (!resolvedWorkLocationId) {
      // Neither the punch nor the employee record has a work location to check against —
      // genuinely can't run a geofence check either way (Option A fallback, only reached when
      // Option B above has nothing to offer).
      this.pushFlag(flags, 'WORK_LOCATION_NOT_ASSIGNED');
      statusCandidates.push(PunchValidationStatus.PENDING_HR_REVIEW);
    }

    if (punch.gpsAccuracy != null && punch.gpsAccuracy > MOBILE_GPS_ACCURACY_MAX_METERS) {
      this.pushFlag(flags, 'GPS_ACCURACY_POOR', { gpsAccuracy: punch.gpsAccuracy });
      fraudScoreDelta += FRAUD_WEIGHTS.POOR_GPS_ACCURACY;
      statusCandidates.push(PunchValidationStatus.PENDING_HR_REVIEW);
    }

    if (this.hasFraudSignal(punch.fraudFlags)) {
      this.pushFlag(flags, 'FAKE_GPS_SIGNAL');
      fraudScoreDelta += FRAUD_WEIGHTS.FAKE_GPS_SIGNAL;
      statusCandidates.push(PunchValidationStatus.REJECTED_FAKE_GPS);
    }

    // Clean: no candidate condition was raised at all — automatically ACCEPTED, not merely
    // "with warning". ACCEPTED_WITH_WARNING is reserved for a source result that raises a
    // non-blocking candidate of its own; today no mobile condition maps there directly (the
    // borderline cases above are handled as PENDING_HR_REVIEW instead, per this unit's own
    // "safer choice" policy), but the tier is kept for a future non-blocking condition.
    if (statusCandidates.length === 0) {
      statusCandidates.push(PunchValidationStatus.ACCEPTED);
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

    // Physical punching devices are on company-controlled hardware at a fixed, already-vetted
    // location — no GPS/geofence check is meaningful or required here (task rule C).
    if (statusCandidates.length === 0) {
      statusCandidates.push(PunchValidationStatus.ACCEPTED);
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

    // Manual punches created directly (not via the approved correction workflow) always require
    // human sign-off in this unit — never auto-accepted. The correction-approval flow
    // (AttendanceCorrectionsService.approveCorrection) creates its own manual punch directly at
    // ACCEPTED_WITH_WARNING and never routes through this validator at all — that is the one and
    // only path a manual punch can become official through, matching this unit's own "manual
    // correction punches should only become accepted through approved correction workflow"
    // policy.
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

    const windowMs = DUPLICATE_WINDOW_MINUTES * 60_000;
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
        AND: [
          { OR: orConditions },
          // "Earlier" is a strict total order: createdAt (millisecond precision), then id as a
          // tie-breaker. Without the tie-break, two simultaneous rows sharing a createdAt
          // millisecond (TIME-01 concurrency test) could each fail to see the other and both
          // be ACCEPTED.
          { OR: [{ createdAt: { lt: punch.createdAt } }, { createdAt: punch.createdAt, id: { lt: punch.id } }] },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 1,
    });

    return candidates[0] ?? null;
  }

  private hasFraudSignal(fraudFlagsJson: Prisma.JsonValue): boolean {
    // TIME-01 fix: the shipped mobile app reports `mockLocationDetected` (Unit 17), which the
    // original list never matched — a client-reported mock location was being auto-ACCEPTED.
    // `mocked`/`ismocked` cover expo-location's own `mocked` property naming.
    const suspiciousKeys = [
      'mocklocation',
      'mocklocationdetected',
      'mocked',
      'ismocked',
      'fakegps',
      'isrooted',
      'isjailbroken',
      'rooted',
      'jailbroken',
    ];
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
