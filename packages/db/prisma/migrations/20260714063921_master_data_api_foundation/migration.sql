-- CreateEnum
CREATE TYPE "WorkLocationType" AS ENUM ('OFFICE', 'FACTORY', 'WAREHOUSE', 'PROJECT_SITE');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "civilId" TEXT;

-- AlterTable
ALTER TABLE "work_locations" ADD COLUMN     "type" "WorkLocationType" NOT NULL DEFAULT 'OFFICE';

-- CreateIndex
CREATE UNIQUE INDEX "employees_civilId_key" ON "employees"("civilId");

