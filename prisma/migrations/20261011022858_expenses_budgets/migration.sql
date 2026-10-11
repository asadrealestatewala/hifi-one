-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'COMPANY',
    "projectId" TEXT,
    "departmentId" TEXT,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "originalAmount" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetTransfer" (
    "id" TEXT NOT NULL,
    "fromBudgetId" TEXT NOT NULL,
    "toBudgetId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseVoucher" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "justification" TEXT,
    "expenseAccountId" TEXT NOT NULL,
    "projectId" TEXT,
    "budgetId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "approvedById" TEXT,
    "decisionNote" TEXT,
    "overBudgetReason" TEXT,
    "journalEntryId" TEXT,
    "paymentEntryId" TEXT,
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Budget_organizationId_idx" ON "Budget"("organizationId");

-- CreateIndex
CREATE INDEX "ExpenseVoucher_organizationId_status_idx" ON "ExpenseVoucher"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ExpenseVoucher_submittedById_idx" ON "ExpenseVoucher"("submittedById");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseVoucher_organizationId_number_key" ON "ExpenseVoucher"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "BudgetTransfer" ADD CONSTRAINT "BudgetTransfer_fromBudgetId_fkey" FOREIGN KEY ("fromBudgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTransfer" ADD CONSTRAINT "BudgetTransfer_toBudgetId_fkey" FOREIGN KEY ("toBudgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseVoucher" ADD CONSTRAINT "ExpenseVoucher_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
