-- DropIndex
DROP INDEX "CommissionEntry_allocationId_key";

-- AlterTable
ALTER TABLE "CommissionEntry" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'SALES_AGENT';

-- CreateTable
CREATE TABLE "CampaignCommissionRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignCommissionRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignCommissionRate_organizationId_active_idx" ON "CampaignCommissionRate"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignCommissionRate_campaignId_role_key" ON "CampaignCommissionRate"("campaignId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_allocationId_role_key" ON "CommissionEntry"("allocationId", "role");

