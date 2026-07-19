/*
  Warnings:

  - Added the required column `correctionType` to the `attendance_corrections` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CorrectionType" AS ENUM ('MISSED_IN', 'MISSED_OUT', 'WRONG_IN', 'WRONG_OUT', 'MANUAL_ADJUSTMENT', 'OTHER');

-- AlterTable
ALTER TABLE "attendance_corrections" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "correctionType" "CorrectionType" NOT NULL,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "requestedPunchTime" TIMESTAMP(3),
ADD COLUMN     "requestedPunchType" "PunchType",
ADD COLUMN     "targetPunchId" TEXT;

-- CreateIndex
CREATE INDEX "attendance_corrections_targetPunchId_idx" ON "attendance_corrections"("targetPunchId");

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_targetPunchId_fkey" FOREIGN KEY ("targetPunchId") REFERENCES "attendance_raw_punches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
