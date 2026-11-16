-- AlterTable
ALTER TABLE "Earner" ADD COLUMN     "inquiryId" TEXT;

-- CreateTable
CREATE TABLE "PartnerIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "earnerId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "idType" TEXT NOT NULL,
    "idNumberEnc" TEXT NOT NULL,
    "idLast4" TEXT NOT NULL,
    "businessName" TEXT,
    "ntn" TEXT,
    "secpNumber" TEXT,
    "activeTaxpayer" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "rejectReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "recheckDueAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPayoutAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "earnerId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "otherName" TEXT,
    "bankName" TEXT,
    "accountTitle" TEXT NOT NULL,
    "accountEnc" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "titleMatches" BOOLEAN NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "usableFrom" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerIdentity_earnerId_key" ON "PartnerIdentity"("earnerId");

-- CreateIndex
CREATE INDEX "PartnerIdentity_organizationId_status_idx" ON "PartnerIdentity"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PartnerPayoutAccount_organizationId_earnerId_idx" ON "PartnerPayoutAccount"("organizationId", "earnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Earner_inquiryId_key" ON "Earner"("inquiryId");

-- AddForeignKey
ALTER TABLE "PartnerIdentity" ADD CONSTRAINT "PartnerIdentity_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPayoutAccount" ADD CONSTRAINT "PartnerPayoutAccount_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

