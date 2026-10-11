-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "creditedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PeriodLock" (
    "organizationId" TEXT NOT NULL,
    "lockedThrough" TEXT NOT NULL,
    "lockedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeriodLock_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "ManualJournal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "taxPortion" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualJournal_organizationId_status_idx" ON "ManualJournal"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_idempotencyKey_key" ON "CreditNote"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_organizationId_number_key" ON "CreditNote"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An invoice can never be paid and credited for more than its total.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_credit_check" CHECK ("creditedAmount" >= 0 AND "amountPaid" + "creditedAmount" <= total);
