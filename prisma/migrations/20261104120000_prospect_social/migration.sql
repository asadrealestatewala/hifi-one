-- Prospector stage 3: a prospect's Facebook page address and the numbers read from it. Additive only.
CREATE TABLE "ProspectSocial" (
    "prospectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facebookUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "status" TEXT NOT NULL DEFAULT 'NOT_FETCHED',
    "provider" TEXT,
    "pageName" TEXT,
    "followers" INTEGER,
    "likes" INTEGER,
    "lastPostAt" TIMESTAMP(3),
    "note" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectSocial_pkey" PRIMARY KEY ("prospectId")
);

CREATE INDEX "ProspectSocial_organizationId_status_idx" ON "ProspectSocial"("organizationId", "status");

ALTER TABLE "ProspectSocial" ADD CONSTRAINT "ProspectSocial_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
