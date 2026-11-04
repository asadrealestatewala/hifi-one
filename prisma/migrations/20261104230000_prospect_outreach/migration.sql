-- Prospector stage 5: a log of each contact with a prospect. Additive only.
CREATE TABLE "ProspectOutreach" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProspectOutreach_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProspectOutreach_prospectId_createdAt_idx" ON "ProspectOutreach"("prospectId", "createdAt");
CREATE INDEX "ProspectOutreach_organizationId_userId_createdAt_idx" ON "ProspectOutreach"("organizationId", "userId", "createdAt");
ALTER TABLE "ProspectOutreach" ADD CONSTRAINT "ProspectOutreach_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
