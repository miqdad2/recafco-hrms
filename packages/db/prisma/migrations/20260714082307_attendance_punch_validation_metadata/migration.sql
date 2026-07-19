-- AlterTable
ALTER TABLE "attendance_raw_punches" ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validatedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "attendance_raw_punches" ADD CONSTRAINT "attendance_raw_punches_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
