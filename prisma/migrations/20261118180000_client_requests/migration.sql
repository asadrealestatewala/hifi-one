-- CreateTable
CREATE TABLE "ClientRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "wantedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientRequest_taskId_key" ON "ClientRequest"("taskId");

-- CreateIndex
CREATE INDEX "ClientRequest_organizationId_status_idx" ON "ClientRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ClientRequest_projectId_status_idx" ON "ClientRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "ClientRequest_clientId_createdAt_idx" ON "ClientRequest"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

