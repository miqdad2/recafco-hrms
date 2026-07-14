-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "AttendanceSourceType" AS ENUM ('MOBILE', 'BIOMETRIC_DEVICE', 'FACE_DEVICE', 'CARD_DEVICE', 'WEB', 'MANUAL_CORRECTION', 'IMPORT', 'FUTURE_INTEGRATION');

-- CreateEnum
CREATE TYPE "PunchType" AS ENUM ('IN', 'OUT', 'BREAK_START', 'BREAK_END');

-- CreateEnum
CREATE TYPE "PunchValidationStatus" AS ENUM ('ACCEPTED', 'ACCEPTED_WITH_WARNING', 'REJECTED_OUTSIDE_LOCATION', 'REJECTED_FAKE_GPS', 'REJECTED_UNREGISTERED_DEVICE', 'REJECTED_EMPLOYEE_INACTIVE', 'REJECTED_DUPLICATE', 'PENDING_HR_REVIEW', 'PENDING_MANAGER_APPROVAL', 'REJECTED_POLICY_VIOLATION');

-- CreateEnum
CREATE TYPE "DailyAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'WEEK_OFF', 'HOLIDAY', 'MISSING_PUNCH');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollLockStatus" AS ENUM ('OPEN', 'LOCKED', 'REOPENED');

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 100,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "sourceType" "AttendanceSourceType" NOT NULL,
    "workLocationId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_devices" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceIdentifier" TEXT NOT NULL,
    "deviceModel" TEXT,
    "osName" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "pushToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "employmentType" "EmploymentType" NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "workLocationId" TEXT,
    "hireDate" TIMESTAMP(3) NOT NULL,
    "terminationDate" TIMESTAMP(3),
    "isMobilePunchAllowed" BOOLEAN NOT NULL DEFAULT true,
    "isDeviceOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "startTimeMinutes" INTEGER NOT NULL,
    "endTimeMinutes" INTEGER NOT NULL,
    "isOvernight" BOOLEAN NOT NULL DEFAULT false,
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_raw_punches" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "punchType" "PunchType" NOT NULL,
    "sourceType" "AttendanceSourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceDeviceId" TEXT,
    "punchTimeSource" TIMESTAMP(3) NOT NULL,
    "punchTimeServer" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracy" DOUBLE PRECISION,
    "distanceFromLocationMeters" DOUBLE PRECISION,
    "workLocationId" TEXT,
    "mobileDeviceId" TEXT,
    "attendanceDeviceId" TEXT,
    "ipAddress" TEXT,
    "wifiSsid" TEXT,
    "wifiBssid" TEXT,
    "selfieFileId" TEXT,
    "validationStatus" "PunchValidationStatus" NOT NULL,
    "fraudScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fraudFlags" JSONB NOT NULL DEFAULT '[]',
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfPunchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_raw_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_daily_summaries" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "officialInPunchId" TEXT,
    "officialOutPunchId" TEXT,
    "officialInTime" TIMESTAMP(3),
    "officialOutTime" TIMESTAMP(3),
    "totalWorkedMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "DailyAttendanceStatus" NOT NULL,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_daily_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "beforeSnapshot" JSONB NOT NULL,
    "afterSnapshot" JSONB NOT NULL,
    "approvedByUserId" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_payroll_locks" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PayrollLockStatus" NOT NULL DEFAULT 'OPEN',
    "lockedByUserId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_payroll_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "designations_code_key" ON "designations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "work_locations_code_key" ON "work_locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_devices_deviceCode_key" ON "attendance_devices"("deviceCode");

-- CreateIndex
CREATE INDEX "attendance_devices_workLocationId_idx" ON "attendance_devices"("workLocationId");

-- CreateIndex
CREATE INDEX "attendance_devices_sourceType_idx" ON "attendance_devices"("sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_devices_deviceIdentifier_key" ON "mobile_devices"("deviceIdentifier");

-- CreateIndex
CREATE INDEX "mobile_devices_employeeId_idx" ON "mobile_devices"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeCode_key" ON "employees"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employees_designationId_idx" ON "employees"("designationId");

-- CreateIndex
CREATE INDEX "employees_workLocationId_idx" ON "employees"("workLocationId");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_code_key" ON "shifts"("code");

-- CreateIndex
CREATE INDEX "shift_assignments_employeeId_effectiveFrom_idx" ON "shift_assignments"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "shift_assignments_shiftId_idx" ON "shift_assignments"("shiftId");

-- CreateIndex
CREATE INDEX "attendance_raw_punches_employeeId_punchTimeServer_idx" ON "attendance_raw_punches"("employeeId", "punchTimeServer");

-- CreateIndex
CREATE INDEX "attendance_raw_punches_workLocationId_idx" ON "attendance_raw_punches"("workLocationId");

-- CreateIndex
CREATE INDEX "attendance_raw_punches_sourceType_idx" ON "attendance_raw_punches"("sourceType");

-- CreateIndex
CREATE INDEX "attendance_raw_punches_validationStatus_idx" ON "attendance_raw_punches"("validationStatus");

-- CreateIndex
CREATE INDEX "attendance_raw_punches_mobileDeviceId_idx" ON "attendance_raw_punches"("mobileDeviceId");

-- CreateIndex
CREATE INDEX "attendance_raw_punches_attendanceDeviceId_idx" ON "attendance_raw_punches"("attendanceDeviceId");

-- CreateIndex
CREATE INDEX "attendance_raw_punches_duplicateOfPunchId_idx" ON "attendance_raw_punches"("duplicateOfPunchId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_raw_punches_attendanceDeviceId_sourceId_key" ON "attendance_raw_punches"("attendanceDeviceId", "sourceId");

-- CreateIndex
CREATE INDEX "attendance_daily_summaries_status_idx" ON "attendance_daily_summaries"("status");

-- CreateIndex
CREATE INDEX "attendance_daily_summaries_lockedAt_idx" ON "attendance_daily_summaries"("lockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_daily_summaries_employeeId_workDate_key" ON "attendance_daily_summaries"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_corrections_employeeId_workDate_idx" ON "attendance_corrections"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_corrections_status_idx" ON "attendance_corrections"("status");

-- CreateIndex
CREATE INDEX "attendance_payroll_locks_periodStart_periodEnd_idx" ON "attendance_payroll_locks"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "attendance_payroll_locks_status_idx" ON "attendance_payroll_locks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_payroll_locks_periodStart_periodEnd_key" ON "attendance_payroll_locks"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "work_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "work_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_raw_punches" ADD CONSTRAINT "attendance_raw_punches_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_raw_punches" ADD CONSTRAINT "attendance_raw_punches_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "work_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_raw_punches" ADD CONSTRAINT "attendance_raw_punches_mobileDeviceId_fkey" FOREIGN KEY ("mobileDeviceId") REFERENCES "mobile_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_raw_punches" ADD CONSTRAINT "attendance_raw_punches_attendanceDeviceId_fkey" FOREIGN KEY ("attendanceDeviceId") REFERENCES "attendance_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_raw_punches" ADD CONSTRAINT "attendance_raw_punches_duplicateOfPunchId_fkey" FOREIGN KEY ("duplicateOfPunchId") REFERENCES "attendance_raw_punches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_daily_summaries" ADD CONSTRAINT "attendance_daily_summaries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_daily_summaries" ADD CONSTRAINT "attendance_daily_summaries_officialInPunchId_fkey" FOREIGN KEY ("officialInPunchId") REFERENCES "attendance_raw_punches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_daily_summaries" ADD CONSTRAINT "attendance_daily_summaries_officialOutPunchId_fkey" FOREIGN KEY ("officialOutPunchId") REFERENCES "attendance_raw_punches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
