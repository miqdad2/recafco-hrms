-- CreateEnum
CREATE TYPE "CalendarPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CalendarAssignmentScope" AS ENUM ('EMPLOYEE', 'SHIFT');

-- CreateEnum
CREATE TYPE "CalendarDayType" AS ENUM ('WORKING_DAY', 'REST_DAY');

-- CreateTable
CREATE TABLE "work_calendars" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workingWeekdays" INTEGER[],
    "status" "CalendarPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalReference" TEXT,
    "activatedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_calendar_assignments" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "scope" "CalendarAssignmentScope" NOT NULL,
    "employeeId" TEXT,
    "shiftId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT,
    "createdByUserId" TEXT,
    "endedByUserId" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_calendar_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_calendar_day_overrides" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT,
    "employeeId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "dayType" "CalendarDayType" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CalendarPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalReference" TEXT,
    "activatedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "deactivatedByUserId" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "deactivationReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_calendar_day_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "CalendarPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT,
    "notes" TEXT,
    "approvalReference" TEXT,
    "activatedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "deactivatedByUserId" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "deactivationReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_calendars_code_key" ON "work_calendars"("code");

-- CreateIndex
CREATE INDEX "work_calendars_status_idx" ON "work_calendars"("status");

-- CreateIndex
CREATE INDEX "work_calendar_assignments_employeeId_effectiveFrom_idx" ON "work_calendar_assignments"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "work_calendar_assignments_shiftId_effectiveFrom_idx" ON "work_calendar_assignments"("shiftId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "work_calendar_assignments_calendarId_idx" ON "work_calendar_assignments"("calendarId");

-- CreateIndex
CREATE INDEX "work_calendar_day_overrides_calendarId_date_idx" ON "work_calendar_day_overrides"("calendarId", "date");

-- CreateIndex
CREATE INDEX "work_calendar_day_overrides_employeeId_date_idx" ON "work_calendar_day_overrides"("employeeId", "date");

-- CreateIndex
CREATE INDEX "public_holidays_startDate_endDate_idx" ON "public_holidays"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "public_holidays_status_idx" ON "public_holidays"("status");

-- AddForeignKey
ALTER TABLE "work_calendar_assignments" ADD CONSTRAINT "work_calendar_assignments_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "work_calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_calendar_assignments" ADD CONSTRAINT "work_calendar_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_calendar_assignments" ADD CONSTRAINT "work_calendar_assignments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_calendar_day_overrides" ADD CONSTRAINT "work_calendar_day_overrides_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "work_calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_calendar_day_overrides" ADD CONSTRAINT "work_calendar_day_overrides_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- HR-POLICY-01: invariants Prisma cannot express (hand-written, additive).
ALTER TABLE "work_calendars" ADD CONSTRAINT "work_calendars_weekdays_valid"
  CHECK ("workingWeekdays" <@ ARRAY[0,1,2,3,4,5,6]::integer[]);
ALTER TABLE "work_calendars" ADD CONSTRAINT "work_calendars_active_needs_approval"
  CHECK ("status" <> 'ACTIVE' OR ("approvalReference" IS NOT NULL AND "activatedAt" IS NOT NULL));
ALTER TABLE "work_calendar_assignments" ADD CONSTRAINT "work_calendar_assignments_one_target"
  CHECK (("scope" = 'EMPLOYEE' AND "employeeId" IS NOT NULL AND "shiftId" IS NULL)
      OR ("scope" = 'SHIFT' AND "shiftId" IS NOT NULL AND "employeeId" IS NULL));
ALTER TABLE "work_calendar_assignments" ADD CONSTRAINT "work_calendar_assignments_range_valid"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "work_calendar_day_overrides" ADD CONSTRAINT "work_calendar_day_overrides_one_target"
  CHECK (("calendarId" IS NULL) <> ("employeeId" IS NULL));
ALTER TABLE "work_calendar_day_overrides" ADD CONSTRAINT "work_calendar_day_overrides_active_needs_approval"
  CHECK ("status" <> 'ACTIVE' OR ("approvalReference" IS NOT NULL AND "activatedAt" IS NOT NULL));
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_range_valid"
  CHECK ("endDate" >= "startDate");
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_active_needs_approval"
  CHECK ("status" <> 'ACTIVE' OR ("approvalReference" IS NOT NULL AND "activatedAt" IS NOT NULL AND "source" IS NOT NULL));
