-- My Requests can be shared with the line manager (HR's Required Changes, item 6). Additive only.
ALTER TABLE "EmployeeRequest" ADD COLUMN "hrOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmployeeRequest" ADD COLUMN "managerId" TEXT;
ALTER TABLE "EmployeeRequest" ADD COLUMN "managerNote" TEXT;
ALTER TABLE "EmployeeRequest" ADD COLUMN "managerNotedAt" TIMESTAMP(3);

CREATE INDEX "EmployeeRequest_managerId_status_idx" ON "EmployeeRequest"("managerId", "status");
