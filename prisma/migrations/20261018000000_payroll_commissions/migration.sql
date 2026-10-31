-- AlterTable
ALTER TABLE "CommissionEntry" ADD COLUMN     "payrollRunId" TEXT;

-- AlterTable
ALTER TABLE "PayrollItem" ADD COLUMN     "commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "commissionTax" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "CommissionEntry_payrollRunId_idx" ON "CommissionEntry"("payrollRunId");

