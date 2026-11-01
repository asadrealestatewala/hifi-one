-- AlterTable
ALTER TABLE "CommissionEntry" ADD COLUMN     "reviewId" TEXT;

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "brief" TEXT,
ADD COLUMN     "sampleUrl" TEXT,
ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "recordingUrl" TEXT;

-- AlterTable
ALTER TABLE "QuotaUsage" ADD COLUMN     "contentItemId" TEXT;

-- CreateTable
CREATE TABLE "ClientReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "meetingId" TEXT,
    "weekStart" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "review" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "rebatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "rebatePool" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRebateTier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "minRating" INTEGER NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRebateTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientReview_organizationId_createdAt_idx" ON "ClientReview"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReview_clientId_weekStart_key" ON "ClientReview"("clientId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRebateTier_organizationId_minRating_key" ON "ReviewRebateTier"("organizationId", "minRating");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_reviewId_userId_key" ON "CommissionEntry"("reviewId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaUsage_contentItemId_key_key" ON "QuotaUsage"("contentItemId", "key");

