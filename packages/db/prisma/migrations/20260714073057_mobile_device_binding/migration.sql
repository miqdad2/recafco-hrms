/*
  Warnings:

  - You are about to drop the column `deviceModel` on the `mobile_devices` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `mobile_devices` table. All the data in the column will be lost.
  - You are about to drop the column `osName` on the `mobile_devices` table. All the data in the column will be lost.
  - Added the required column `platform` to the `mobile_devices` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MobilePlatform" AS ENUM ('ANDROID', 'IOS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MobileDeviceStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'BLOCKED', 'DEACTIVATED');

-- AlterTable
ALTER TABLE "mobile_devices" DROP COLUMN "deviceModel",
DROP COLUMN "isActive",
DROP COLUMN "osName",
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "blockReason" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedByUserId" TEXT,
ADD COLUMN     "deviceName" TEXT,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "platform" "MobilePlatform" NOT NULL,
ADD COLUMN     "status" "MobileDeviceStatus" NOT NULL DEFAULT 'PENDING_APPROVAL';

-- CreateIndex
CREATE INDEX "mobile_devices_status_idx" ON "mobile_devices"("status");

-- CreateIndex
CREATE INDEX "mobile_devices_platform_idx" ON "mobile_devices"("platform");

-- CreateIndex
CREATE INDEX "mobile_devices_isPrimary_idx" ON "mobile_devices"("isPrimary");

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_blockedByUserId_fkey" FOREIGN KEY ("blockedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
