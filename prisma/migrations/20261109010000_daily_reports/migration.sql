-- Daily reports from employees, reviewed by their manager or HR. Additive only.
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "blockers" TEXT,
    "plan" TEXT,
    "hoursWorked" DECIMAL(4,1),
    "late" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "rating" INTEGER,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyReport_userId_workDate_key" ON "DailyReport"("userId", "workDate");
CREATE INDEX "DailyReport_organizationId_workDate_idx" ON "DailyReport"("organizationId", "workDate");
