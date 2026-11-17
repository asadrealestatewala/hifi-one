-- AlterTable
ALTER TABLE "ResaleCount" ADD COLUMN     "reportedAt" TIMESTAMP(3),
ADD COLUMN     "reportedUnits" INTEGER,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'PARTNER',
ALTER COLUMN "enteredById" DROP NOT NULL;


-- Counts staff entered were confirmed by the same person at once
UPDATE "ResaleCount" SET "source" = 'STAFF' WHERE "confirmedById" IS NOT NULL AND "confirmedById" = "enteredById";
