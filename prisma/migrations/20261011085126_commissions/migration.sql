-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMISSION',
    "allocationId" TEXT,
    "invoiceId" TEXT,
    "clientId" TEXT,
    "currency" TEXT NOT NULL,
    "base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ratePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EARNED',
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "accrualEntryId" TEXT,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRule_organizationId_userId_key" ON "CommissionRule"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_allocationId_key" ON "CommissionEntry"("allocationId");

-- CreateIndex
CREATE INDEX "CommissionEntry_organizationId_status_idx" ON "CommissionEntry"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CommissionEntry_userId_createdAt_idx" ON "CommissionEntry"("userId", "createdAt");
