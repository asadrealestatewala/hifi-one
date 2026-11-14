-- AlterTable
ALTER TABLE "AcademyCourse" ADD COLUMN     "refresherAskedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AcademyTestAttempt" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'FINAL';

-- AlterTable
ALTER TABLE "PartnerCertificate" ADD COLUMN     "secondReminderAt" TIMESTAMP(3);


-- The certificate of authorisation now lasts 12 months and is renewed by the Academy refresher test, with reminders 30, 7
-- and 1 day before it expires. Only settings nobody has edited (still the old defaults, never saved by a person) move.
UPDATE "PartnerSetting" SET "value" = '365' WHERE "key" = 'cert_expiry_days' AND "value" = '30' AND "updatedById" IS NULL;
UPDATE "PartnerSetting" SET "value" = '30' WHERE "key" = 'cert_first_reminder_days' AND "value" = '7' AND "updatedById" IS NULL;
