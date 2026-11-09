import {
  AttendanceDeviceType,
  AttendanceSourceType,
  EmploymentType,
  MobileDeviceStatus,
  MobilePlatform,
  PayrollLockStatus,
} from '@recafco/db';
import { getTestPrismaClient } from './test-prisma';

// INCIDENT-02: explicit test-database client only (never the shared application client).
const prisma = getTestPrismaClient();

/** Kuwait City reference point used as the geofence centre in tests. */
export const SITE = { latitude: 29.3759, longitude: 47.9774, radiusMeters: 100 } as const;
/** ~11 m north of SITE — comfortably inside a 100 m geofence. */
export const INSIDE = { latitude: 29.3760, longitude: 47.9774 } as const;
/** ~1.1 km north of SITE — outside the geofence. */
export const OUTSIDE = { latitude: 29.3859, longitude: 47.9774 } as const;

let sequence = 0;
function next(prefix: string): string {
  sequence += 1;
  return `${prefix}${Date.now().toString(36)}${sequence}`.toUpperCase();
}

export interface MobileEmployeeFixture {
  employeeId: string;
  employeeCode: string;
  userId: string;
  workLocationId: string;
  deviceIdentifier: string;
  mobileDeviceId: string;
}

export async function createMobileEmployee(
  options: { deviceStatus?: MobileDeviceStatus } = {},
): Promise<MobileEmployeeFixture> {
  const workLocation = await prisma.workLocation.create({
    data: {
      name: 'Test HQ',
      code: next('LOC'),
      latitude: SITE.latitude,
      longitude: SITE.longitude,
      geofenceRadiusMeters: SITE.radiusMeters,
      timezone: 'Asia/Kuwait',
    },
  });
  const employeeCode = next('EMP');
  const employee = await prisma.employee.create({
    data: {
      employeeCode,
      firstName: 'Test',
      lastName: 'Employee',
      employmentType: EmploymentType.FULL_TIME,
      hireDate: new Date('2024-01-01T00:00:00Z'),
      workLocationId: workLocation.id,
    },
  });
  const user = await prisma.user.create({
    data: { username: next('user'), passwordHash: 'not-used-in-tests', employeeId: employee.id },
  });
  const deviceIdentifier = `android-id:${next('dev')}`;
  const device = await prisma.mobileDevice.create({
    data: {
      employeeId: employee.id,
      deviceIdentifier,
      platform: MobilePlatform.ANDROID,
      status: options.deviceStatus ?? MobileDeviceStatus.APPROVED,
      isPrimary: true,
    },
  });
  return {
    employeeId: employee.id,
    employeeCode,
    userId: user.id,
    workLocationId: workLocation.id,
    deviceIdentifier,
    mobileDeviceId: device.id,
  };
}

/** A user with no employee link, used as the actor for admin/device-import calls. */
export async function createAdminUser(): Promise<string> {
  const user = await prisma.user.create({ data: { username: next('admin'), passwordHash: 'not-used-in-tests' } });
  return user.id;
}

export async function createBiometricDevice(workLocationId: string): Promise<string> {
  const device = await prisma.attendanceDevice.create({
    data: {
      name: 'Test Biometric',
      deviceCode: next('BIO'),
      sourceType: AttendanceSourceType.BIOMETRIC_DEVICE,
      deviceType: AttendanceDeviceType.BIOMETRIC,
      workLocationId,
    },
  });
  return device.id;
}

/** A LOCKED payroll period covering [startDate, endDate] (YYYY-MM-DD, inclusive). */
export async function createLockedPeriod(startDate: string, endDate: string): Promise<string> {
  const lock = await prisma.attendancePayrollLock.create({
    data: {
      periodStart: new Date(`${startDate}T00:00:00Z`),
      periodEnd: new Date(`${endDate}T00:00:00Z`),
      status: PayrollLockStatus.LOCKED,
      lockedAt: new Date(),
    },
  });
  return lock.id;
}

export function flagNames(fraudFlags: unknown): string[] {
  return Array.isArray(fraudFlags)
    ? fraudFlags
        .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>).flag : undefined))
        .filter((f): f is string => typeof f === 'string')
    : [];
}

/** YYYY-MM-DD of the Asia/Kuwait (UTC+3) calendar day containing `instant`. */
export function kuwaitDate(instant: Date): string {
  return new Date(instant.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}
