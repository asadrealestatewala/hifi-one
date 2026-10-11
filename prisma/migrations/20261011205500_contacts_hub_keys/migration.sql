-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "matchKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ContactActivity" ADD COLUMN     "leadActivityId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ContactActivity_leadActivityId_key" ON "ContactActivity"("leadActivityId");

-- CreateIndex
CREATE INDEX "Contact_matchKeys_idx" ON "Contact" USING GIN ("matchKeys");
