-- Agent commission paid once per client (first paid invoice only)
ALTER TABLE "CampaignCommissionRate" ADD COLUMN "firstPaymentOnly" BOOLEAN NOT NULL DEFAULT false;

-- Client portal invites by contact number when there is no email yet
ALTER TABLE "ClientInvite" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "ClientInvite" ADD COLUMN "phone" TEXT;

-- Weekly reviews the client gives directly (emailed form or portal)
ALTER TABLE "ClientReview" ALTER COLUMN "reviewerId" DROP NOT NULL;
ALTER TABLE "ClientReview" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'STAFF';

CREATE TABLE "ClientReviewRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentTo" TEXT,
    "emailStatus" TEXT,
    "answeredAt" TIMESTAMP(3),
    "reviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientReviewRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientReviewRequest_tokenHash_key" ON "ClientReviewRequest"("tokenHash");
CREATE UNIQUE INDEX "ClientReviewRequest_clientId_weekStart_key" ON "ClientReviewRequest"("clientId", "weekStart");
CREATE INDEX "ClientReviewRequest_organizationId_createdAt_idx" ON "ClientReviewRequest"("organizationId", "createdAt");

-- Project manager monthly bonus
CREATE TABLE "PmBonusSetting" (
    "organizationId" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "minAverage" DECIMAL(3,2) NOT NULL DEFAULT 4.5,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PmBonusSetting_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "PmMonthlyBonus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "projectManagerId" TEXT,
    "reviews" INTEGER NOT NULL,
    "average" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "minAverage" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PmMonthlyBonus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PmMonthlyBonus_entryId_key" ON "PmMonthlyBonus"("entryId");
CREATE UNIQUE INDEX "PmMonthlyBonus_clientId_month_key" ON "PmMonthlyBonus"("clientId", "month");
CREATE INDEX "PmMonthlyBonus_organizationId_month_idx" ON "PmMonthlyBonus"("organizationId", "month");
