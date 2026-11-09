-- TIME-01: server-authoritative mobile punch time + mobile retry idempotency.
-- Additive only: three nullable columns and one unique index. No existing row is rewritten;
-- every historical row keeps NULL in the new columns (NULLs are not constrained by the index).

-- AlterTable
ALTER TABLE "attendance_raw_punches" ADD COLUMN     "clientReportedTime" TIMESTAMP(3),
ADD COLUMN     "clientRequestFingerprint" TEXT,
ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "attendance_raw_punches_employeeId_sourceType_clientRequestI_key" ON "attendance_raw_punches"("employeeId", "sourceType", "clientRequestId");
