/**
 * Characterisation + backward-compatibility suite for POST /attendance-punches/mobile.
 *
 * Every request here uses the LEGACY payload shape sent by already-installed APKs (pre-TIME-01):
 * the phone's clock in `punchTimeSource`, no `clientRequestId`. These tests were written and run
 * against the unmodified code first (TIME-01 Phase A) to pin down existing validation behaviour;
 * they must keep passing afterwards, proving old APKs still work and no rule was weakened.
 *
 * Uses the real wall clock (no clock override) so it is valid against both old and new code.
 */
import type { INestApplication } from '@nestjs/common';
import { MobileDeviceStatus } from '@recafco/db';
import request from 'supertest';
import { accessTokenFor, createTestApp, resetDatabase } from '../support/app';
import {
  createAdminUser,
  createBiometricDevice,
  createLockedPeriod,
  createMobileEmployee,
  flagNames,
  INSIDE,
  kuwaitDate,
  OUTSIDE,
  type MobileEmployeeFixture,
} from '../support/fixtures';
import { getTestPrismaClient } from '../support/test-prisma';

const prisma = getTestPrismaClient();

const MOBILE_PERMISSIONS = ['attendancePunches.createMobile'];

describe('Mobile punch — legacy APK payload (characterisation)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  function legacyPunch(
    fixture: MobileEmployeeFixture,
    overrides: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/attendance-punches/mobile')
      .set('Authorization', `Bearer ${accessTokenFor(app, fixture.userId, MOBILE_PERMISSIONS)}`)
      .send({
        punchType: 'IN',
        punchTimeSource: new Date().toISOString(),
        latitude: INSIDE.latitude,
        longitude: INSIDE.longitude,
        gpsAccuracy: 12,
        deviceIdentifier: fixture.deviceIdentifier,
        appVersion: '1.0.0',
        fraudSignals: { mockLocationDetected: false, locationPermissionStatus: 'granted' },
        ...overrides,
      });
  }

  async function summaryFor(employeeId: string, instant: Date) {
    return prisma.attendanceDailySummary.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: new Date(`${kuwaitDate(instant)}T00:00:00Z`) } },
    });
  }

  it('accepts a clean punch inside the geofence and builds the daily summary', async () => {
    const fixture = await createMobileEmployee();
    const res = await legacyPunch(fixture);

    expect(res.status).toBe(201);
    expect(res.body.validationStatus).toBe('ACCEPTED');
    expect(res.body.isOfficial).toBe(true);
    const summary = await summaryFor(fixture.employeeId, new Date(res.body.punchTimeSource));
    expect(summary?.officialInPunchId).toBe(res.body.id);
    expect(summary?.status).toBe('MISSING_PUNCH'); // IN without OUT yet
  });

  it('rejects a punch outside the geofence and never makes it official', async () => {
    const fixture = await createMobileEmployee();
    const res = await legacyPunch(fixture, { latitude: OUTSIDE.latitude, longitude: OUTSIDE.longitude });

    expect(res.status).toBe(201);
    expect(res.body.validationStatus).toBe('REJECTED_OUTSIDE_LOCATION');
    expect(res.body.isOfficial).toBe(false);
    expect(flagNames(res.body.fraudFlags)).toContain('OUTSIDE_GEOFENCE');
    expect(await summaryFor(fixture.employeeId, new Date())).toBeNull();
  });

  it('rejects a punch from a blocked device but still stores the attempt', async () => {
    const fixture = await createMobileEmployee({ deviceStatus: MobileDeviceStatus.BLOCKED });
    const res = await legacyPunch(fixture);

    expect(res.status).toBe(201);
    expect(res.body.validationStatus).toBe('REJECTED_UNREGISTERED_DEVICE');
    expect(flagNames(res.body.fraudFlags)).toContain('DEVICE_BLOCKED');
    expect(await prisma.attendanceRawPunch.count({ where: { employeeId: fixture.employeeId } })).toBe(1);
  });

  it('never auto-accepts a suspected mock location', async () => {
    const fixture = await createMobileEmployee();
    const res = await legacyPunch(fixture, { fraudSignals: { mockLocationDetected: true } });

    expect(res.body.validationStatus).toBe('REJECTED_FAKE_GPS');
    expect(res.body.isOfficial).toBe(false);
  });

  it('sends poor GPS accuracy to HR review instead of accepting it', async () => {
    const fixture = await createMobileEmployee();
    const res = await legacyPunch(fixture, { gpsAccuracy: 250 });

    expect(res.body.validationStatus).toBe('PENDING_HR_REVIEW');
    expect(flagNames(res.body.fraudFlags)).toContain('GPS_ACCURACY_POOR');
  });

  it('stores an accepted punch for a locked period but never touches the locked summary', async () => {
    const fixture = await createMobileEmployee();
    const today = kuwaitDate(new Date());
    await createLockedPeriod(today, today);

    const res = await legacyPunch(fixture);

    expect(res.status).toBe(201);
    expect(res.body.validationStatus).toBe('ACCEPTED');
    expect(res.body.isOfficial).toBe(false);
    expect(flagNames(res.body.fraudFlags)).toContain('LOCKED_PERIOD_LATE_PUNCH');
    expect(await summaryFor(fixture.employeeId, new Date())).toBeNull();
  });

  it('combines a mobile IN with a biometric OUT into one daily summary', async () => {
    const fixture = await createMobileEmployee();
    const inRes = await legacyPunch(fixture);
    expect(inRes.body.validationStatus).toBe('ACCEPTED');

    const adminId = await createAdminUser();
    const biometricId = await createBiometricDevice(fixture.workLocationId);
    const outTime = new Date(new Date(inRes.body.punchTimeSource).getTime() + 60_000);
    const outRes = await request(app.getHttpServer())
      .post('/attendance-punches/device-import')
      .set('Authorization', `Bearer ${accessTokenFor(app, adminId, ['attendancePunches.createDeviceImport'])}`)
      .send({
        attendanceDeviceId: biometricId,
        sourceId: 'bio-log-1',
        employeeCode: fixture.employeeCode,
        punchType: 'OUT',
        punchTimeSource: outTime.toISOString(),
      });

    expect(outRes.status).toBe(200);
    expect(outRes.body.validationStatus).toBe('ACCEPTED');
    // Biometric event time is preserved exactly (TIME-01 must not alter device-import timestamps).
    expect(outRes.body.punchTimeSource).toBe(outTime.toISOString());

    const summary = await summaryFor(fixture.employeeId, outTime);
    expect(summary?.officialInPunchId).toBe(inRes.body.id);
    expect(summary?.officialOutPunchId).toBe(outRes.body.id);
    expect(summary?.status).toBe('PRESENT');
  });

  it('SECURITY: a phone clock set 30 minutes back does not change the official punch time (legacy APK)', async () => {
    const fixture = await createMobileEmployee();
    const before = Date.now();
    const res = await legacyPunch(fixture, { punchTimeSource: new Date(before - 30 * 60_000).toISOString() });
    const after = Date.now();

    expect(res.status).toBe(201);
    const official = new Date(res.body.punchTimeSource).getTime();
    expect(official).toBeGreaterThanOrEqual(before - 1000);
    expect(official).toBeLessThanOrEqual(after + 1000);
  });
});
