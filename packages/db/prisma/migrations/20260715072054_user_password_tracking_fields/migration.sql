-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "passwordReminderDismissedAt" TIMESTAMP(3),
ADD COLUMN     "temporaryPasswordIssuedAt" TIMESTAMP(3);
