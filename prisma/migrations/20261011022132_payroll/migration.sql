-- CreateTable
CREATE TABLE "SalaryStructure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "basic" DECIMAL(14,2) NOT NULL,
    "allowance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "paymentEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workingDays" INTEGER NOT NULL,
    "unpaidDays" DECIMAL(5,1) NOT NULL,
    "basic" DECIMAL(14,2) NOT NULL,
    "allowance" DECIMAL(14,2) NOT NULL,
    "bonus" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unpaidDeduction" DECIMAL(14,2) NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "taxPercent" DECIMAL(5,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryStructure_userId_idx" ON "SalaryStructure"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructure_userId_effectiveFrom_key" ON "SalaryStructure"("userId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_organizationId_period_currency_key" ON "PayrollRun"("organizationId", "period", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_runId_userId_key" ON "PayrollItem"("runId", "userId");

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payroll lines are frozen once the run leaves DRAFT: no edits or deletes afterwards.
CREATE OR REPLACE FUNCTION forbid_locked_payroll_item_change() RETURNS trigger AS $$
DECLARE run_status text;
BEGIN
  SELECT status INTO run_status FROM "PayrollRun" WHERE id = COALESCE(NEW."runId", OLD."runId");
  IF run_status IS NOT NULL AND run_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Payroll run is locked. Use an adjustment in a later period.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_item_locked BEFORE UPDATE OR DELETE ON "PayrollItem"
  FOR EACH ROW EXECUTE FUNCTION forbid_locked_payroll_item_change();
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_amounts_check" CHECK (net >= 0 AND gross >= 0 AND tax >= 0 AND basic >= 0);
