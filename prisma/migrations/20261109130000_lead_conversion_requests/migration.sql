-- CreateTable
CREATE TABLE "LeadConversionRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "wonStageId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadConversionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadConversionRequest_organizationId_status_createdAt_idx" ON "LeadConversionRequest"("organizationId", "status", "createdAt");
CREATE INDEX "LeadConversionRequest_leadId_idx" ON "LeadConversionRequest"("leadId");
CREATE INDEX "LeadConversionRequest_requestedById_createdAt_idx" ON "LeadConversionRequest"("requestedById", "createdAt");

-- One open request per lead
CREATE UNIQUE INDEX "LeadConversionRequest_one_pending_per_lead" ON "LeadConversionRequest"("leadId") WHERE "status" = 'PENDING';

ALTER TABLE "LeadConversionRequest" ADD CONSTRAINT "LeadConversionRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
