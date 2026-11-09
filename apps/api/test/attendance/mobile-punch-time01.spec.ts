/**
 * TIME-01 — server-authoritative mobile punch time, mock-location handling, idempotent retries.
 * DESTRUCTIVE (truncates between tests) — runs only against the guarded `recafco_hrms_test`
 * with RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test (see test/support/database-guard.ts).
 *
 * The server clock is a FixedClock, so every timestamp assertion is exact.
 */
import type { INestApplication } from '@nestjs/common';
import { MobileDeviceStatus } from '@recafco/db';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClockService } from '../../src/common/clock.service';
import { accessTokenFor, createTestApp, resetDatabase } from '../support/app';
import {
  createAdminUser,
  createBiometricDevice,
  createLockedPeriod,
  createMobileEmployee,
  flagNames,
  INSIDE,
  OUTSIDE,
  type MobileEmployeeFixture,
} from '../support/fixtures';
import { FixedClock } from '../support/fixed-clock';
import { getTestPrismaClient } from '../support/test-prisma';

const prisma = getTestPrismaClient();
const SERVER_NOW = '2026-11-08T06:00:00.000Z'; // 09:00 Asia/Kuwait
const clock = new FixedClock(SERVER_NOW);

describe('TIME-01 mobile punch intake', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp([{ token: ClockService, value: clock }]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(SERVER_NOW);
    await resetDatabase();
  });

  function punch(fixture: MobileEmployeeFixture, body: Record<string, unknown> = {}): request.Test {
    return request(app.getHttpServer())
      .post('/attendance-punches/mobile')
      .set('Authorization', `Bearer ${accessTokenFor(app, fixture.userId, ['attendancePunches.createMobile'])}`)
      .send({
        punchType: 'IN',
        clientRequestId: randomUUID(),
        clientReportedTime: SERVER_NOW,
        latitude: INSIDE.latitude,
        longitude: INSIDE.longitude,
        gpsAccuracy: 10,
        deviceIdentifier: fixture.deviceIdentifier,
        fraudSignals: { mockLocationDetected: false },
        ...body,
      });
  }

  function summary(employeeId: string, workDate: string) {
    return prisma.attendanceDailySummary.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: new Date(`${workDate}T00:00:00Z`) } },
    });
  }

  describe('server-authoritative timestamp', () => {
    it.each([
      ['1. phone clock 30 minutes BACKWARD', '2026-11-08T05:30:00.000Z', -1800],
      ['2. phone clock 30 minutes FORWARD', '2026-11-08T06:30:00.000Z', 1800],
    ])('%s: official time is the server receipt time; skew only flagged', async (_label, phoneTime, skew) => {
      const fixture = await createMobileEmployee();
      const res = await punch(fixture, { clientReportedTime: phoneTime });

      expect(res.status).toBe(201);
      expect(res.body.punchTimeSource).toBe(SERVER_NOW);
      expect(res.body.punchTimeServer).toBe(SERVER_NOW);
      expect(res.body.clientReportedTime).toBe(phoneTime);
      expect(res.body.validationStatus).toBe('ACCEPTED'); // skew is diagnostic, not a rejection
      const skewFlag = (res.body.fraudFlags as Record<string, unknown>[]).find((f) => f.flag === 'CLIENT_CLOCK_SKEW');
      expect(skewFlag).toMatchObject({ source: 'INTAKE', skewSeconds: skew });
      expect((await summary(fixture.employeeId, '2026-11-08'))?.officialInTime?.toISOString()).toBe(SERVER_NOW);
    });

    it('3. a fabricated ISO timestamp (far future, exotic offset) cannot move the official instant', async () => {
      const fixture = await createMobileEmployee();
      const fabricated = '2030-01-01T00:00:00+14:00';
      const res = await punch(fixture, { clientReportedTime: fabricated });

      expect(res.status).toBe(201);
      expect(res.body.punchTimeSource).toBe(SERVER_NOW);
      expect(res.body.rawPayload.submittedClientTime).toBe(fabricated);
      expect(flagNames(res.body.fraudFlags)).toContain('CLIENT_CLOCK_SKEW');
    });

    it('3b. an old APK sending the legacy punchTimeSource field cannot move the official instant either', async () => {
      const fixture = await createMobileEmployee();
      const res = await punch(fixture, {
        clientRequestId: undefined,
        clientReportedTime: undefined,
        punchTimeSource: '2026-11-07T23:00:00.000Z',
      });

      expect(res.status).toBe(201);
      expect(res.body.punchTimeSource).toBe(SERVER_NOW);
      expect(res.body.clientReportedTime).toBe('2026-11-07T23:00:00.000Z');
      expect(flagNames(res.body.fraudFlags)).toEqual(
        expect.arrayContaining(['CLIENT_CLOCK_SKEW', 'LEGACY_CLIENT_NO_REQUEST_ID']),
      );
    });

    it('4. a request with no client timestamp at all is accepted and stamped by the server', async () => {
      const fixture = await createMobileEmployee();
      const res = await punch(fixture, { clientReportedTime: undefined });

      expect(res.status).toBe(201);
      expect(res.body.punchTimeSource).toBe(SERVER_NOW);
      expect(res.body.clientReportedTime).toBeNull();
      expect(flagNames(res.body.fraudFlags)).not.toContain('CLIENT_CLOCK_SKEW');
    });

    it('5. Kuwait midnight boundary: the work date follows server time, not the phone', async () => {
      const fixture = await createMobileEmployee();

      clock.set('2026-11-08T20:59:59.000Z'); // 23:59:59 Kuwait, 8 Nov
      const late = await punch(fixture, { clientReportedTime: '2026-11-08T21:05:00.000Z' }); // phone says 9 Nov
      expect(late.body.punchTimeSource).toBe('2026-11-08T20:59:59.000Z');
      expect((await summary(fixture.employeeId, '2026-11-08'))?.officialInPunchId).toBe(late.body.id);

      clock.set('2026-11-08T21:00:00.000Z'); // 00:00:00 Kuwait, 9 Nov
      const early = await punch(fixture, { punchType: 'OUT', clientReportedTime: '2026-11-08T20:55:00.000Z' }); // phone says 8 Nov
      expect(early.body.punchTimeSource).toBe('2026-11-08T21:00:00.000Z');
      expect((await summary(fixture.employeeId, '2026-11-09'))?.officialOutPunchId).toBe(early.body.id);
      expect((await summary(fixture.employeeId, '2026-11-08'))?.officialOutPunchId).toBeNull();
    });
  });

  describe('idempotent retries', () => {
    it('6. an identical retry returns the original punch and does not recalculate again', async () => {
      const fixture = await createMobileEmployee();
      const clientRequestId = randomUUID();
      const first = await punch(fixture, { clientRequestId });
      const versionAfterFirst = (await summary(fixture.employeeId, '2026-11-08'))?.calculationVersion;

      clock.set('2026-11-08T06:00:20.000Z'); // the retry arrives 20 s later
      const retry = await punch(fixture, { clientRequestId, clientReportedTime: '2026-11-08T06:00:20.000Z' });

      expect(first.headers['idempotent-replayed']).toBe('false');
      expect(retry.status).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.punchTimeSource).toBe(SERVER_NOW); // original receipt time preserved
      expect(await prisma.attendanceRawPunch.count({ where: { employeeId: fixture.employeeId } })).toBe(1);
      expect((await summary(fixture.employeeId, '2026-11-08'))?.calculationVersion).toBe(versionAfterFirst);
    });

    it('7. reusing a request id with a different payload is refused (409) and stores nothing new', async () => {
      const fixture = await createMobileEmployee();
      const clientRequestId = randomUUID();
      const first = await punch(fixture, {
        clientRequestId,
        latitude: OUTSIDE.latitude,
        longitude: OUTSIDE.longitude,
      });
      expect(first.body.validationStatus).toBe('REJECTED_OUTSIDE_LOCATION');

      const tampered = await punch(fixture, { clientRequestId }); // same id, coordinates moved inside
      expect(tampered.status).toBe(409);
      expect(tampered.body.code).toBe('CLIENT_REQUEST_ID_REUSED');
      expect(await prisma.attendanceRawPunch.count({ where: { employeeId: fixture.employeeId } })).toBe(1);

      const flipped = await punch(fixture, {
        clientRequestId,
        latitude: OUTSIDE.latitude,
        longitude: OUTSIDE.longitude,
        fraudSignals: { mockLocationDetected: true },
      });
      expect(flipped.status).toBe(409);
    });

    it('8. two simultaneous requests for the same action store exactly one punch', async () => {
      const fixture = await createMobileEmployee();
      const clientRequestId = randomUUID();
      const [a, b] = await Promise.all([punch(fixture, { clientRequestId }), punch(fixture, { clientRequestId })]);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect([a.headers['idempotent-replayed'], b.headers['idempotent-replayed']].sort()).toEqual(['false', 'true']);
      expect(await prisma.attendanceRawPunch.count({ where: { employeeId: fixture.employeeId } })).toBe(1);
    });

    it('request ids are scoped per employee: two employees may use the same id', async () => {
      const one = await createMobileEmployee();
      const two = await createMobileEmployee();
      const clientRequestId = randomUUID();
      const a = await punch(one, { clientRequestId });
      const b = await punch(two, { clientRequestId });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).not.toBe(b.body.id);
    });
  });

  describe('location and device validation (unchanged rules)', () => {
    it('9. a clean punch inside the geofence is accepted and becomes official', async () => {
      const fixture = await createMobileEmployee();
      const res = await punch(fixture);
      expect(res.body.validationStatus).toBe('ACCEPTED');
      expect(res.body.isOfficial).toBe(true);
    });

    it('10. a punch outside the geofence is rejected and never official', async () => {
      const fixture = await createMobileEmployee();
      const res = await punch(fixture, { latitude: OUTSIDE.latitude, longitude: OUTSIDE.longitude });
      expect(res.body.validationStatus).toBe('REJECTED_OUTSIDE_LOCATION');
      expect(res.body.isOfficial).toBe(false);
      expect(await summary(fixture.employeeId, '2026-11-08')).toBeNull();
    });

    it('11. a punch from a blocked device is stored but rejected', async () => {
      const fixture = await createMobileEmployee({ deviceStatus: MobileDeviceStatus.BLOCKED });
      const res = await punch(fixture);
      expect(res.status).toBe(201);
      expect(res.body.validationStatus).toBe('REJECTED_UNREGISTERED_DEVICE');
      expect(flagNames(res.body.fraudFlags)).toContain('DEVICE_BLOCKED');
    });

    it.each(['IN', 'OUT'])('mock location (mockLocationDetected=true) on %s is never auto-accepted', async (punchType) => {
      const fixture = await createMobileEmployee();
      const res = await punch(fixture, { punchType, fraudSignals: { mockLocationDetected: true } });
      expect(res.body.validationStatus).toBe('REJECTED_FAKE_GPS');
      expect(res.body.isOfficial).toBe(false);
      expect(flagNames(res.body.fraudFlags)).toContain('FAKE_GPS_SIGNAL');
    });

    it('IN and OUT are validated independently: an accepted IN does not carry an outside-geofence OUT', async () => {
      const fixture = await createMobileEmployee();
      const inRes = await punch(fixture);
      clock.set('2026-11-08T14:00:00.000Z');
      const outRes = await punch(fixture, { punchType: 'OUT', latitude: OUTSIDE.latitude, longitude: OUTSIDE.longitude });

      expect(inRes.body.validationStatus).toBe('ACCEPTED');
      expect(outRes.body.validationStatus).toBe('REJECTED_OUTSIDE_LOCATION');
      const day = await summary(fixture.employeeId, '2026-11-08');
      expect(day?.officialInPunchId).toBe(inRes.body.id);
      expect(day?.officialOutPunchId).toBeNull();
      expect(day?.status).toBe('MISSING_PUNCH');
    });

    it('12. a punch in a locked payroll period is stored and flagged; the summary is never created or changed', async () => {
      const fixture = await createMobileEmployee();
      await createLockedPeriod('2026-11-01', '2026-11-30');
      const res = await punch(fixture);

      expect(res.status).toBe(201);
      expect(res.body.validationStatus).toBe('ACCEPTED');
      expect(res.body.isOfficial).toBe(false);
      expect(flagNames(res.body.fraudFlags)).toContain('LOCKED_PERIOD_LATE_PUNCH');
      expect(await summary(fixture.employeeId, '2026-11-08')).toBeNull();
    });
  });

  it('13. mobile IN + biometric OUT: one summary; the biometric event time is preserved, not replaced by import time', async () => {
    const fixture = await createMobileEmployee();
    const inRes = await punch(fixture);

    const adminId = await createAdminUser();
    const biometricId = await createBiometricDevice(fixture.workLocationId);
    const deviceEventTime = '2026-11-08T14:05:00.000Z'; // 17:05 Kuwait, synced later
    const outRes = await request(app.getHttpServer())
      .post('/attendance-punches/device-import')
      .set('Authorization', `Bearer ${accessTokenFor(app, adminId, ['attendancePunches.createDeviceImport'])}`)
      .send({
        attendanceDeviceId: biometricId,
        sourceId: 'bio-0001',
        employeeCode: fixture.employeeCode,
        punchType: 'OUT',
        punchTimeSource: deviceEventTime,
      });

    expect(outRes.status).toBe(200);
    expect(outRes.body.punchTimeSource).toBe(deviceEventTime);
    expect(outRes.body.punchTimeServer).not.toBe(deviceEventTime);
    expect(outRes.body.clientReportedTime).toBeNull();
    const day = await summary(fixture.employeeId, '2026-11-08');
    expect(day?.officialInPunchId).toBe(inRes.body.id);
    expect(day?.officialOutPunchId).toBe(outRes.body.id);
    expect(day?.status).toBe('PRESENT');
    expect(day?.totalWorkedMinutes).toBe(485); // 06:00Z → 14:05Z
  });
});
