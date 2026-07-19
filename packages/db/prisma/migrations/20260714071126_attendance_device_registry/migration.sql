-- CreateEnum
CREATE TYPE "AttendanceDeviceType" AS ENUM ('BIOMETRIC', 'FACE_RECOGNITION', 'CARD', 'QR_TERMINAL', 'TURNSTILE', 'OTHER');

-- CreateEnum
CREATE TYPE "AttendanceConnectionMode" AS ENUM ('NETWORK_PULL', 'API', 'DATABASE_SYNC', 'FILE_IMPORT', 'MANUAL_IMPORT', 'UNKNOWN');

-- AlterTable
ALTER TABLE "attendance_devices" ADD COLUMN     "connectionMode" "AttendanceConnectionMode" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "deviceType" "AttendanceDeviceType" NOT NULL,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "port" INTEGER,
ADD COLUMN     "serialNumber" TEXT,
ADD COLUMN     "vendor" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "attendance_devices_serialNumber_key" ON "attendance_devices"("serialNumber");

-- CreateIndex
CREATE INDEX "attendance_devices_deviceType_idx" ON "attendance_devices"("deviceType");

-- CreateIndex
CREATE INDEX "attendance_devices_connectionMode_idx" ON "attendance_devices"("connectionMode");

