-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementLineId" TEXT,
    "journalLineId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STATEMENT',
    "matchedById" TEXT,
    "reconciliationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementDate" TEXT NOT NULL,
    "statementBalance" DECIMAL(14,2) NOT NULL,
    "ledgerBalance" DECIMAL(14,2) NOT NULL,
    "outstandingLedger" DECIMAL(14,2) NOT NULL,
    "unmatchedStatement" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_bankAccountId_date_idx" ON "BankStatementLine"("organizationId", "bankAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_bankAccountId_dedupKey_key" ON "BankStatementLine"("bankAccountId", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "BankMatch_statementLineId_key" ON "BankMatch"("statementLineId");

-- CreateIndex
CREATE UNIQUE INDEX "BankMatch_journalLineId_key" ON "BankMatch"("journalLineId");

-- CreateIndex
CREATE INDEX "BankMatch_bankAccountId_idx" ON "BankMatch"("bankAccountId");

-- CreateIndex
CREATE INDEX "BankReconciliation_organizationId_bankAccountId_statementDa_idx" ON "BankReconciliation"("organizationId", "bankAccountId", "statementDate");
