#!/usr/bin/env node
/**
 * Generates validation-v1.scenarios.json — the shared, deterministic NestJS/Rust parity inputs.
 * Synthetic data only (no real employees). Re-run after editing; inputs are composed from a base
 * fixture plus per-scenario overrides so every scenario differs from "clean" in exactly the ways
 * its title says.
 *
 *   node packages/attendance-test-vectors/build-validation-scenarios.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const T0 = '2026-11-08T06:00:00.000Z'; // 09:00 Asia/Kuwait
const SITE = { latitude: 29.3759, longitude: 47.9774 };
const INSIDE = { latitude: 29.376, longitude: 47.9774 }; // ~11 m from SITE
const OUTSIDE = { latitude: 29.3859, longitude: 47.9774 }; // ~1.1 km from SITE
const NO_MOCK = [{ flag: 'CLIENT_REPORTED_SIGNALS', signals: { mockLocationDetected: false, locationPermissionStatus: 'granted' } }];
const signals = (s) => [{ flag: 'CLIENT_REPORTED_SIGNALS', signals: s }];

const baseContext = () => ({
  employee: { id: 'emp-1', status: 'ACTIVE', isMobilePunchAllowed: true, isDeviceOnly: false, workLocationId: 'loc-hq' },
  workLocations: {
    'loc-hq': { ...SITE, geofenceRadiusMeters: 100, isActive: true },
    'loc-closed': { latitude: 29.3, longitude: 47.9, geofenceRadiusMeters: 100, isActive: false },
  },
  mobileDevices: {
    'mdev-1': { employeeId: 'emp-1', status: 'APPROVED', deviceIdentifier: 'android-id:FIXTURE-0001' },
  },
  attendanceDevices: {
    'bio-1': { isActive: true, workLocationId: 'loc-hq' },
    'bio-2': { isActive: true, workLocationId: 'loc-hq' },
  },
  earlierPunches: [],
  lockedWorkDates: [],
});

const mobilePunch = (over = {}) => ({
  id: 'p-subject',
  punchType: 'IN',
  sourceType: 'MOBILE',
  punchTimeSource: T0,
  ...INSIDE,
  gpsAccuracy: 12,
  mobileDeviceId: 'mdev-1',
  fraudFlags: NO_MOCK,
  ...over,
});
const bioPunch = (over = {}) => ({
  id: 'p-subject',
  punchType: 'IN',
  sourceType: 'BIOMETRIC_DEVICE',
  punchTimeSource: T0,
  attendanceDeviceId: 'bio-1',
  sourceId: 'bio-log-1001',
  ...over,
});
const earlier = (over) => ({ id: 'p-earlier', punchType: 'IN', sourceType: 'MOBILE', punchTimeSource: T0, ...over });

const validation = (id, title, punch, contextOver = {}) => ({
  id,
  title,
  kind: 'validation',
  input: { punch, ...baseContext(), ...contextOver },
});

const intakeRequest = (over = {}) => ({
  punchType: 'IN',
  clientRequestId: '0f8e1c2a-3b4d-4e5f-8a6b-7c8d9e0f1a2b',
  clientReportedTime: T0,
  ...INSIDE,
  gpsAccuracy: 12,
  deviceIdentifier: 'android-id:FIXTURE-0001',
  fraudSignals: { mockLocationDetected: false, locationPermissionStatus: 'granted' },
  appVersion: '1.0.0',
  ...over,
});
const intake = (id, title, request, serverReceivedAt = T0, contextOver = {}) => {
  const { employee, workLocations, mobileDevices, attendanceDevices, earlierPunches, lockedWorkDates } = baseContext();
  return {
    id,
    title,
    kind: 'mobileIntake',
    input: {
      punchId: 'p-subject',
      serverReceivedAt,
      request,
      employee,
      workLocations,
      mobileDevices,
      attendanceDevices,
      earlierPunches,
      lockedWorkDates,
      ...contextOver,
    },
  };
};

const ctx = baseContext();
const scenarios = [
  // --- clean paths
  validation('V01-clean-mobile-in', 'Clean approved mobile IN (app sends no workLocationId → inferred from employee default)', mobilePunch()),
  validation('V02-clean-mobile-out', 'Clean approved mobile OUT', mobilePunch({ punchType: 'OUT' })),
  validation('V03-clean-mobile-in-explicit-location', 'Clean mobile IN with an explicit workLocationId (no inference flag)', mobilePunch({ workLocationId: 'loc-hq' })),
  validation('V04-biometric-in', 'Valid biometric IN (no GPS required)', bioPunch()),
  validation('V05-biometric-out', 'Valid biometric OUT', bioPunch({ punchType: 'OUT', sourceId: 'bio-log-1002' })),
  validation('V06-face-device-in', 'FACE_DEVICE source takes the physical-device path', bioPunch({ sourceType: 'FACE_DEVICE' })),
  // --- location / GPS
  validation('V07-outside-geofence', 'Mobile IN ~1.1 km outside a 100 m geofence', mobilePunch({ ...OUTSIDE })),
  validation('V08-poor-gps-accuracy', 'Mobile IN with 250 m GPS accuracy', mobilePunch({ gpsAccuracy: 250 })),
  validation('V09-gps-accuracy-exactly-100', 'GPS accuracy exactly 100 m is acceptable (rule is > 100)', mobilePunch({ gpsAccuracy: 100 })),
  validation('V10-gps-accuracy-100.5', 'GPS accuracy 100.5 m goes to review', mobilePunch({ gpsAccuracy: 100.5 })),
  validation('V11-gps-accuracy-missing', 'No gpsAccuracy value: accuracy rule not applied', mobilePunch({ gpsAccuracy: null })),
  validation('V12-missing-location', 'Mobile IN without latitude/longitude', mobilePunch({ latitude: null, longitude: null })),
  validation('V13-missing-longitude-only', 'Latitude present, longitude missing', mobilePunch({ longitude: null })),
  validation('V14-no-work-location-anywhere', 'Neither punch nor employee has a work location', mobilePunch(), {
    employee: { ...ctx.employee, workLocationId: null },
  }),
  validation('V15-explicit-inactive-work-location', 'Punch names an inactive work location', mobilePunch({ workLocationId: 'loc-closed' })),
  validation('V16-default-work-location-inactive', 'Employee default work location is inactive (inferred)', mobilePunch(), {
    employee: { ...ctx.employee, workLocationId: 'loc-closed' },
  }),
  validation('V17-inactive-location-and-missing-gps', 'Inactive location + no coordinates: both conditions accumulate', mobilePunch({ workLocationId: 'loc-closed', latitude: null, longitude: null })),
  // --- mock / fraud signals
  validation('V18-mock-location-detected', 'App reports mockLocationDetected=true', mobilePunch({ fraudFlags: signals({ mockLocationDetected: true }) })),
  validation('V19-mock-location-on-out', 'Mock location on OUT is rejected independently', mobilePunch({ punchType: 'OUT', fraudFlags: signals({ mockLocationDetected: true }) })),
  validation('V20-mocked-key-variant', 'expo-location style `isMocked: true`', mobilePunch({ fraudFlags: signals({ isMocked: true }) })),
  validation('V21-rooted-signal', 'Rooted device signal', mobilePunch({ fraudFlags: signals({ rooted: true }) })),
  validation('V22-mock-signal-string-true', 'Existing behaviour: "true" as a STRING is not a signal (strict boolean)', mobilePunch({ fraudFlags: signals({ mockLocationDetected: 'true' }) })),
  validation('V23-multiple-issues', 'Outside + poor accuracy + mock: most severe wins, score and flags accumulate', mobilePunch({ ...OUTSIDE, gpsAccuracy: 250, fraudFlags: signals({ mockLocationDetected: true }) })),
  // --- mobile device / employee
  validation('V24-device-pending-approval', 'Mobile device registered but not yet approved', mobilePunch(), {
    mobileDevices: { 'mdev-1': { ...ctx.mobileDevices['mdev-1'], status: 'PENDING_APPROVAL' } },
  }),
  validation('V25-device-blocked', 'Blocked mobile device', mobilePunch(), {
    mobileDevices: { 'mdev-1': { ...ctx.mobileDevices['mdev-1'], status: 'BLOCKED' } },
  }),
  validation('V26-device-deactivated', 'Deactivated mobile device', mobilePunch(), {
    mobileDevices: { 'mdev-1': { ...ctx.mobileDevices['mdev-1'], status: 'DEACTIVATED' } },
  }),
  validation('V27-device-of-other-employee', 'Approved device belonging to another employee', mobilePunch(), {
    mobileDevices: { 'mdev-1': { ...ctx.mobileDevices['mdev-1'], employeeId: 'emp-2' } },
  }),
  validation('V28-no-mobile-device', 'Unknown device identifier (no device row linked)', mobilePunch({ mobileDeviceId: null })),
  validation('V29-employee-resigned', 'Inactive (RESIGNED) employee', mobilePunch(), { employee: { ...ctx.employee, status: 'RESIGNED' } }),
  validation('V30-employee-on-leave', 'ON_LEAVE is also not ACTIVE', bioPunch(), { employee: { ...ctx.employee, status: 'ON_LEAVE' } }),
  validation('V31-device-only-employee-on-mobile', 'isDeviceOnly employee punching from mobile', mobilePunch(), {
    employee: { ...ctx.employee, isDeviceOnly: true },
  }),
  validation('V32-mobile-not-allowed', 'isMobilePunchAllowed=false', mobilePunch(), { employee: { ...ctx.employee, isMobilePunchAllowed: false } }),
  // --- physical devices
  validation('V33-biometric-device-inactive', 'Biometric punch from an inactive device', bioPunch(), {
    attendanceDevices: { ...ctx.attendanceDevices, 'bio-1': { isActive: false, workLocationId: 'loc-hq' } },
  }),
  validation('V34-biometric-at-inactive-location', 'Biometric device installed at an inactive work location', bioPunch(), {
    attendanceDevices: { ...ctx.attendanceDevices, 'bio-1': { isActive: true, workLocationId: 'loc-closed' } },
  }),
  validation('V35-device-source-without-device', 'BIOMETRIC_DEVICE punch with no attendanceDeviceId', bioPunch({ attendanceDeviceId: null, sourceId: null })),
  validation('V36-web-source-routes-to-device-path', 'Existing behaviour: WEB source is validated by the device path', bioPunch({ sourceType: 'WEB', attendanceDeviceId: null, sourceId: null })),
  // --- duplicates
  validation('V37-duplicate-mobile-60s', 'Same mobile IN 60 s after an earlier one', mobilePunch(), {
    earlierPunches: [earlier({ punchTimeSource: '2026-11-08T05:59:00.000Z' })],
  }),
  validation('V38-duplicate-window-inclusive-120s', 'Earlier punch exactly 2 min before: inside the inclusive window', mobilePunch(), {
    earlierPunches: [earlier({ punchTimeSource: '2026-11-08T05:58:00.000Z' })],
  }),
  validation('V39-not-duplicate-121s', 'Earlier punch 121 s before: outside the window', mobilePunch(), {
    earlierPunches: [earlier({ punchTimeSource: '2026-11-08T05:57:59.000Z' })],
  }),
  validation('V40-earlier-out-does-not-duplicate-in', 'Different punchType never duplicates', mobilePunch(), {
    earlierPunches: [earlier({ punchType: 'OUT', punchTimeSource: '2026-11-08T05:59:30.000Z' })],
  }),
  validation('V41-earlier-biometric-does-not-duplicate-mobile', 'Different sourceType never duplicates (mixed sources allowed)', mobilePunch(), {
    earlierPunches: [earlier({ sourceType: 'BIOMETRIC_DEVICE', punchTimeSource: '2026-11-08T05:59:30.000Z', sourceId: 'x' })],
  }),
  validation('V42-earlier-rejected-still-duplicates', 'Existing behaviour: an earlier REJECTED punch still makes this a duplicate', mobilePunch(), {
    earlierPunches: [earlier({ punchTimeSource: '2026-11-08T05:59:50.000Z', validationStatus: 'REJECTED_OUTSIDE_LOCATION' })],
  }),
  validation('V43-duplicate-biometric-event-window', 'Biometric IN 30 s after another biometric IN (different log ids)', bioPunch(), {
    earlierPunches: [earlier({ id: 'p-earlier', sourceType: 'BIOMETRIC_DEVICE', punchTimeSource: '2026-11-08T05:59:30.000Z', sourceId: 'bio-log-0999' })],
  }),
  validation('V44-duplicate-biometric-same-source-id-hours-apart', 'Existing behaviour: same sourceId hours apart is a duplicate (sourceId match ignores time)', bioPunch({ attendanceDeviceId: 'bio-2' }), {
    earlierPunches: [earlier({ sourceType: 'BIOMETRIC_DEVICE', punchTimeSource: '2026-11-08T02:00:00.000Z', sourceId: 'bio-log-1001' })],
  }),
  validation('V45-earliest-of-two-candidates-is-original', 'Two qualifying earlier punches: the earliest-created is the original', mobilePunch(), {
    earlierPunches: [
      earlier({ id: 'p-first', punchTimeSource: '2026-11-08T05:59:10.000Z' }),
      earlier({ id: 'p-second', punchTimeSource: '2026-11-08T05:59:40.000Z' }),
    ],
  }),
  validation('V46-explicit-duplicate-link', 'Row already linked via duplicateOfPunchId (re-validation path)', mobilePunch({ duplicateOfPunchId: 'p-earlier' }), {
    earlierPunches: [earlier({ punchTimeSource: '2026-11-08T03:00:00.000Z' })],
  }),
  validation('V47-employee-inactive-beats-duplicate', 'Inactive employee is decided before duplicate detection', mobilePunch(), {
    employee: { ...ctx.employee, status: 'TERMINATED' },
    earlierPunches: [earlier({ punchTimeSource: '2026-11-08T05:59:00.000Z' })],
  }),
  // --- manual
  validation('V48-manual-with-reason', 'Manual punch with a reason requires manager approval', {
    id: 'p-subject', punchType: 'IN', sourceType: 'MANUAL_CORRECTION', punchTimeSource: T0, rawPayload: { reason: 'Forgot to punch at gate' },
  }),
  validation('V49-manual-without-reason', 'Manual punch with a blank reason', {
    id: 'p-subject', punchType: 'IN', sourceType: 'MANUAL_CORRECTION', punchTimeSource: T0, rawPayload: { reason: '   ' },
  }),
  // --- dates / payroll lock / preserved flags
  validation('V50-kuwait-boundary-before-midnight', 'Official instant 23:59:59.999 Kuwait → same work date', mobilePunch({ punchTimeSource: '2026-11-08T20:59:59.999Z' })),
  validation('V51-kuwait-boundary-at-midnight', 'Official instant 00:00:00.000 Kuwait → next work date', mobilePunch({ punchTimeSource: '2026-11-08T21:00:00.000Z' })),
  validation('V52-accepted-in-locked-period', 'Accepted punch on a locked work date gets LOCKED_PERIOD_LATE_PUNCH', mobilePunch(), { lockedWorkDates: ['2026-11-08'] }),
  validation('V53-rejected-in-locked-period', 'Rejected punch on a locked date gets no lock flag', mobilePunch({ ...OUTSIDE }), { lockedWorkDates: ['2026-11-08'] }),
  validation('V54-biometric-in-locked-period', 'Late-synced biometric event into a locked date', bioPunch(), { lockedWorkDates: ['2026-11-08'] }),
  validation('V55-preserved-intake-flags-stale-engine-flag-dropped', 'Intake flags kept in order; a stale engine flag from a previous run is dropped', mobilePunch({
    fraudFlags: [
      { flag: 'CLIENT_REPORTED_SIGNALS', signals: { mockLocationDetected: false } },
      { source: 'INTAKE', flag: 'CLIENT_CLOCK_SKEW', skewSeconds: -1800 },
      { source: 'VALIDATION_ENGINE', flag: 'OUTSIDE_GEOFENCE', distanceMeters: 5000, allowedRadiusMeters: 100 },
    ],
  })),
  // --- TIME-01 intake (createMobile → processNewPunch)
  intake('I01-trusted-server-timestamp', 'Phone clock agrees with server: official = server receipt, no skew flag', intakeRequest()),
  intake('I02-phone-30-min-backward', 'Phone clock 30 min behind', intakeRequest({ clientReportedTime: '2026-11-08T05:30:00.000Z' })),
  intake('I03-phone-30-min-forward', 'Phone clock 30 min ahead', intakeRequest({ clientReportedTime: '2026-11-08T06:30:00.000Z' })),
  intake('I04-fabricated-client-timestamp', 'Fabricated far-future timestamp with +14:00 offset', intakeRequest({ clientReportedTime: '2030-01-01T00:00:00+14:00' })),
  intake('I05-no-client-timestamp', 'No client clock sent', intakeRequest({ clientReportedTime: undefined })),
  intake('I06-legacy-apk', 'Pre-TIME-01 APK: legacy punchTimeSource, no clientRequestId', intakeRequest({ clientRequestId: undefined, clientReportedTime: undefined, punchTimeSource: '2026-11-07T23:00:00.000Z' })),
  intake('I07-skew-exactly-300s', 'Skew of exactly +300 s is not flagged (rule is > 300)', intakeRequest({ clientReportedTime: '2026-11-08T06:05:00.000Z' })),
  intake('I08-skew-301s', 'Skew of +301 s is flagged', intakeRequest({ clientReportedTime: '2026-11-08T06:05:01.000Z' })),
  intake('I09-skew-half-second-rounding', 'JS Math.round semantics: -1800.5 s rounds to -1800', intakeRequest({ clientReportedTime: '2026-11-08T05:29:59.500Z' })),
  intake('I10-mock-via-intake', 'mockLocationDetected=true through the real intake path', intakeRequest({ fraudSignals: { mockLocationDetected: true } })),
  intake('I11-kuwait-boundary-server-time-decides', 'Server receipt at Kuwait midnight; phone claims previous day', intakeRequest({ clientReportedTime: '2026-11-08T20:55:00.000Z' }), '2026-11-08T21:00:00.000Z'),
  intake('I12-unknown-device-identifier', 'Device identifier not registered', intakeRequest({ deviceIdentifier: 'android-id:UNKNOWN' })),
];

const document = {
  schemaVersion: 'recafco-attendance-validation-scenarios/1',
  rulesetVersion: 'nest-post-time01-2026-11-08',
  resultContractVersion: 'attendance-validation-result/1',
  notes:
    'Synthetic data only. Inputs only — expected outcomes live in validation-v1.expected.json (recorded from NestJS, reviewed, frozen). ' +
    'earlierPunches are ordered ascending by (createdAt, id) and all precede the subject punch.',
  scenarios: JSON.parse(JSON.stringify(scenarios)), // drops undefined fields
};

const out = join(dirname(fileURLToPath(import.meta.url)), 'validation-v1.scenarios.json');
writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${scenarios.length} scenarios to ${out}`);
