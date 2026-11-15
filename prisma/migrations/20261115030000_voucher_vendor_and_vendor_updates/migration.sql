-- Expense vouchers can name a registered vendor; project updates can be shown to vendors working on the project.
ALTER TABLE "ExpenseVoucher" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "ExpenseVoucher" ADD CONSTRAINT "ExpenseVoucher_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ExpenseVoucher_vendorId_idx" ON "ExpenseVoucher"("vendorId");
ALTER TABLE "ProjectUpdate" ADD COLUMN "visibleToVendor" BOOLEAN NOT NULL DEFAULT false;
