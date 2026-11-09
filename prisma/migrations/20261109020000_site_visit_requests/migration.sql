-- Site visit, field work and work-from-home requests with manager or HR approval. Additive only.
CREATE TABLE "SiteVisitRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "location" TEXT,
    "clientId" TEXT,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisitRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteVisitRequest_organizationId_startDate_status_idx" ON "SiteVisitRequest"("organizationId", "startDate", "status");
CREATE INDEX "SiteVisitRequest_userId_status_idx" ON "SiteVisitRequest"("userId", "status");

ALTER TABLE "SiteVisitRequest" ADD CONSTRAINT "SiteVisitRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
