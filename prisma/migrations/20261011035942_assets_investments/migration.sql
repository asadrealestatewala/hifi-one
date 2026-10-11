-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "serialNumber" TEXT,
    "supplier" TEXT,
    "purchaseDate" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "salvageValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "assignedToId" TEXT,
    "purchaseEntryId" TEXT,
    "disposedDate" TEXT,
    "disposalProceeds" DECIMAL(14,2),
    "disposalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationEntry" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "journalEntryId" TEXT,

    CONSTRAINT "DepreciationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),

    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "investee" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "investmentDate" TEXT NOT NULL,
    "ownershipPct" DECIMAL(5,2),
    "expectedReturn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentTransaction" (
    "id" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TEXT NOT NULL,
    "note" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_organizationId_number_key" ON "Asset"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationEntry_assetId_period_key" ON "DepreciationEntry"("assetId", "period");

-- CreateIndex
CREATE INDEX "AssetAssignment_assetId_idx" ON "AssetAssignment"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Investment_organizationId_number_key" ON "Investment"("organizationId", "number");

-- CreateIndex
CREATE INDEX "InvestmentTransaction_investmentId_idx" ON "InvestmentTransaction"("investmentId");

-- AddForeignKey
ALTER TABLE "DepreciationEntry" ADD CONSTRAINT "DepreciationEntry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
