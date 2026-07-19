-- AlterTable
ALTER TABLE "attendance_payroll_locks" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "summaryCount" INTEGER;
