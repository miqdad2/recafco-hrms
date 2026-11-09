/**
 * RUST-02 NestJS side of the validation parity check.
 *
 * For every scenario in packages/attendance-test-vectors/validation-v1.scenarios.json this seeds
 * exactly the scenario's facts into the guarded test database and runs the REAL, unmodified
 * production code path:
 *   kind "validation"   → AttendanceValidationService.processNewPunch (auto-validation + lock flag)
 *   kind "mobileIntake" → AttendancePunchesService.createMobile with a fixed server clock
 * The resulting row is converted to the canonical outcome (database ids mapped back to fixture
 * refs) and compared with validation-v1.expected.json. All outcomes are also written to
 * apps/api/test-output/parity/nest-results.json for the direct NestJS↔Rust cross-check.
 *
 * Record mode (PARITY_RECORD=1) skips the comparison — used once to capture the expected file,
 * which is then reviewed by hand and frozen.
 *
 * DESTRUCTIVE: truncates the guarded recafco_hrms_test between scenarios (needs
 * RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test). Never touches any other database.
 */
import type { INestApplication } from '@nestjs/common';
import {
  AttendanceDeviceType,
  AttendanceSourceType,
  EmploymentType,
  MobilePlatform,
  PayrollLockStatus,
  PunchValidationStatus,
  type AttendanceRawPunch,
  type Prisma,
} from '@recafco/db';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AttendancePunchesService } from '../../src/attendance-punches/attendance-punches.service';
import { AttendanceValidationService } from '../../src/attendance-punches/attendance-validation.service';
import type { CreateMobilePunchDto } from '../../src/attendance-punches/dto/create-mobile-punch.dto';
import { toKuwaitWorkDate } from '../../src/attendance-summaries/kuwait-date.util';
import { ClockService } from '../../src/common/clock.service';
import { createTestApp, resetDatabase } from '../support/app';
import { FixedClock } from '../support/fixed-clock';
import { getTestPrismaClient } from '../support/test-prisma';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { compareOutcome } = require('../../../../packages/attendance-test-vectors/parity-compare.cjs') as {
  compareOutcome: (e: unknown, a: unknown) => { equal: boolean; differences: unknown[]; flagOrderMatches: boolean };
};

const VECTORS_DIR = resolve(__dirname, '../../../../packages/attendance-test-vectors');
const OUTPUT_DIR = resolve(__dirname, '../../test-output/parity');
const RECORD = process.env.PARITY_RECORD === '1';

interface Scenario {
  id: string;
  title: string;
  kind: 'validation' | 'mobileIntake';
  input: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const scenarioDoc = JSON.parse(readFileSync(resolve(VECTORS_DIR, 'validation-v1.scenarios.json'), 'utf8')) as {
  rulesetVersion: string;
  resultContractVersion: string;
  scenarios: Scenario[];
};
const expectedDoc = RECORD
  ? null
  : (JSON.parse(readFileSync(resolve(VECTORS_DIR, 'validation-v1.expected.json'), 'utf8')) as {
      outcomes: Record<string, unknown>;
    });

const prisma = getTestPrismaClient();
const clock = new FixedClock('2026-11-08T06:00:00.000Z');
const ctx = { ipAddress: null, userAgent: null };
const results: Record<string, unknown> = {};

/** Bidirectional fixture-ref ↔ database-id map for one scenario. */
class RefMap {
  private readonly toId = new Map<string, string>();
  private readonly toRef = new Map<string, string>();
  set(ref: string, id: string): void {
    this.toId.set(ref, id);
    this.toRef.set(id, ref);
  }
  id(ref: string | null | undefined): string | null {
    if (ref == null) return null;
    const id = this.toId.get(ref);
    if (!id) throw new Error(`fixture ref "${ref}" was not seeded`);
    return id;
  }
  /** Replace every string equal to a seeded database id with its fixture ref (deep). */
  refs(value: unknown): unknown {
    if (typeof value === 'string') return this.toRef.get(value) ?? value;
    if (Array.isArray(value)) return value.map((v) => this.refs(v));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.refs(v)]));
    }
    return value;
  }
}

const BASE_CREATED_AT = Date.parse('2026-11-08T12:00:00.000Z');

async function seedContext(input: Record<string, any>, refs: RefMap): Promise<{ employeeId: string; userId: string; actorId: string }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const [ref, wl] of Object.entries<any>(input.workLocations ?? {})) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = await prisma.workLocation.create({
      data: { name: ref, code: ref, latitude: wl.latitude, longitude: wl.longitude, geofenceRadiusMeters: wl.geofenceRadiusMeters, isActive: wl.isActive },
    });
    refs.set(ref, row.id);
  }
  if (!input.employee) throw new Error('scenarios without an employee row are not representable in NestJS (FK)');
  const employeeRefs = new Set<string>([input.employee.id]);
  for (const device of Object.values<any>(input.mobileDevices ?? {})) employeeRefs.add(device.employeeId); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const ref of employeeRefs) {
    const main = ref === input.employee.id;
    const row = await prisma.employee.create({
      data: {
        employeeCode: ref,
        firstName: 'Fixture',
        lastName: ref,
        employmentType: EmploymentType.FULL_TIME,
        hireDate: new Date('2024-01-01T00:00:00Z'),
        status: main ? input.employee.status : 'ACTIVE',
        isMobilePunchAllowed: main ? input.employee.isMobilePunchAllowed : true,
        isDeviceOnly: main ? input.employee.isDeviceOnly : false,
        workLocationId: main ? refs.id(input.employee.workLocationId) : null,
      },
    });
    refs.set(ref, row.id);
  }
  const employeeId = refs.id(input.employee.id) as string;
  const user = await prisma.user.create({ data: { username: `u-${input.employee.id}`, passwordHash: 'x', employeeId } });
  const actor = await prisma.user.create({ data: { username: 'parity-actor', passwordHash: 'x' } });

  for (const [ref, d] of Object.entries<any>(input.mobileDevices ?? {})) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = await prisma.mobileDevice.create({
      data: {
        employeeId: refs.id(d.employeeId) as string,
        deviceIdentifier: d.deviceIdentifier ?? `id-${ref}`,
        platform: MobilePlatform.ANDROID,
        status: d.status,
        isPrimary: true,
      },
    });
    refs.set(ref, row.id);
  }
  for (const [ref, d] of Object.entries<any>(input.attendanceDevices ?? {})) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = await prisma.attendanceDevice.create({
      data: {
        name: ref,
        deviceCode: ref,
        sourceType: AttendanceSourceType.BIOMETRIC_DEVICE,
        deviceType: AttendanceDeviceType.BIOMETRIC,
        workLocationId: refs.id(d.workLocationId) as string,
        isActive: d.isActive,
      },
    });
    refs.set(ref, row.id);
  }
  const earlier: any[] = input.earlierPunches ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const [index, p] of earlier.entries()) {
    const row = await prisma.attendanceRawPunch.create({
      data: {
        employeeId,
        punchType: p.punchType,
        sourceType: p.sourceType,
        sourceId: p.sourceId ?? null,
        punchTimeSource: new Date(p.punchTimeSource),
        punchTimeServer: new Date(p.punchTimeSource),
        validationStatus: p.validationStatus ?? PunchValidationStatus.ACCEPTED,
        createdAt: new Date(BASE_CREATED_AT - (earlier.length - index) * 1000),
      },
    });
    refs.set(p.id, row.id);
  }
  for (const date of input.lockedWorkDates ?? []) {
    await prisma.attendancePayrollLock.create({
      data: { periodStart: new Date(`${date}T00:00:00Z`), periodEnd: new Date(`${date}T00:00:00Z`), status: PayrollLockStatus.LOCKED, lockedAt: new Date() },
    });
  }
  return { employeeId, userId: user.id, actorId: actor.id };
}

function canonicalOutcome(punch: AttendanceRawPunch, refs: RefMap): unknown {
  return {
    validationStatus: punch.validationStatus,
    fraudScore: punch.fraudScore,
    fraudFlags: refs.refs(punch.fraudFlags),
    distanceFromLocationMeters: punch.distanceFromLocationMeters,
    duplicateOfPunchId: refs.refs(punch.duplicateOfPunchId) ?? null,
    workDate: toKuwaitWorkDate(punch.punchTimeSource).toISOString().slice(0, 10),
    punchTimeSource: punch.punchTimeSource.toISOString(),
    clientReportedTime: punch.clientReportedTime?.toISOString() ?? null,
  };
}

async function runScenario(scenario: Scenario, app: INestApplication): Promise<unknown> {
  const refs = new RefMap();
  const { input } = scenario;
  const { employeeId, userId, actorId } = await seedContext(input, refs);

  if (scenario.kind === 'mobileIntake') {
    clock.set(input.serverReceivedAt);
    const request = { ...input.request, workLocationId: refs.id(input.request.workLocationId) ?? undefined };
    const dto = JSON.parse(JSON.stringify(request)) as CreateMobilePunchDto; // drops undefined, like a JSON body
    const { punch } = await app.get(AttendancePunchesService).createMobile(dto, userId, ctx);
    refs.set(input.punchId, punch.id);
    return canonicalOutcome(punch, refs);
  }

  const p = input.punch;
  const data: Prisma.AttendanceRawPunchUncheckedCreateInput = {
    employeeId,
    punchType: p.punchType,
    sourceType: p.sourceType,
    sourceId: p.sourceId ?? null,
    punchTimeSource: new Date(p.punchTimeSource),
    punchTimeServer: new Date(p.punchTimeSource),
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    gpsAccuracy: p.gpsAccuracy ?? null,
    workLocationId: refs.id(p.workLocationId),
    mobileDeviceId: refs.id(p.mobileDeviceId),
    attendanceDeviceId: refs.id(p.attendanceDeviceId),
    duplicateOfPunchId: refs.id(p.duplicateOfPunchId),
    validationStatus: PunchValidationStatus.PENDING_HR_REVIEW,
    fraudFlags: (p.fraudFlags ?? []) as Prisma.InputJsonValue,
    rawPayload: (p.rawPayload ?? {}) as Prisma.InputJsonValue,
    createdAt: new Date(BASE_CREATED_AT),
  };
  const created = await prisma.attendanceRawPunch.create({ data });
  refs.set(p.id, created.id);
  const { punch } = await app.get(AttendanceValidationService).processNewPunch(created, actorId, ctx);
  return canonicalOutcome(punch, refs);
}

describe(`RUST-02 validation parity — NestJS side (${scenarioDoc.rulesetVersion})`, () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp([{ token: ClockService, value: clock }]);
  });
  afterAll(async () => {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(
      resolve(OUTPUT_DIR, 'nest-results.json'),
      `${JSON.stringify({ producer: 'nestjs', rulesetVersion: scenarioDoc.rulesetVersion, resultContractVersion: scenarioDoc.resultContractVersion, outcomes: results }, null, 2)}\n`,
    );
    await app.close();
  });

  it.each(scenarioDoc.scenarios.map((s) => [s.id, s] as const))('%s', async (_id, scenario) => {
    await resetDatabase();
    const outcome = await runScenario(scenario, app);
    results[scenario.id] = outcome;
    if (!RECORD) {
      const expected = expectedDoc?.outcomes[scenario.id];
      expect(expected).toBeDefined();
      const comparison = compareOutcome(expected, outcome);
      expect(comparison.differences).toEqual([]);
      expect(comparison.flagOrderMatches).toBe(true);
    }
  });
});
