-- General applications from employees to HR (certificates, advances, resignations, grievances, equipment, other). Additive only.
CREATE TABLE "EmployeeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeRequest_organizationId_status_createdAt_idx" ON "EmployeeRequest"("organizationId", "status", "createdAt");
CREATE INDEX "EmployeeRequest_userId_createdAt_idx" ON "EmployeeRequest"("userId", "createdAt");
