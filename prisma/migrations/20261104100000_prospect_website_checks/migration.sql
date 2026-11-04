-- Prospector stage 2: website check results and queue. Additive only.
CREATE TABLE "ProspectWebsiteCheck" (
    "prospectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "error" TEXT,
    "url" TEXT,
    "finalUrl" TEXT,
    "httpStatus" INTEGER,
    "reachable" BOOLEAN,
    "https" BOOLEAN,
    "hasTitle" BOOLEAN,
    "hasMetaDescription" BOOLEAN,
    "hasAnalytics" BOOLEAN,
    "hasGtm" BOOLEAN,
    "hasMetaPixel" BOOLEAN,
    "hasContactForm" BOOLEAN,
    "hasWhatsapp" BOOLEAN,
    "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
    "psiStatus" TEXT,
    "psiNote" TEXT,
    "mobileScore" INTEGER,
    "seoScore" INTEGER,
    "fcpMs" INTEGER,
    "lcpMs" INTEGER,
    "tbtMs" INTEGER,
    "cls" DECIMAL(6,3),
    "speedIndexMs" INTEGER,
    CONSTRAINT "ProspectWebsiteCheck_pkey" PRIMARY KEY ("prospectId")
);

CREATE INDEX "ProspectWebsiteCheck_organizationId_status_queuedAt_idx" ON "ProspectWebsiteCheck"("organizationId", "status", "queuedAt");

ALTER TABLE "ProspectWebsiteCheck" ADD CONSTRAINT "ProspectWebsiteCheck_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
