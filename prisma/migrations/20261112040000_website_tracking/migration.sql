-- Website (domain-only) tracking, off by default. Additive.
ALTER TABLE "MonitoringPolicy" ADD COLUMN "trackWebsites" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "WebUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WebUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebUsage_userId_day_domain_key" ON "WebUsage"("userId", "day", "domain");
CREATE INDEX "WebUsage_organizationId_day_idx" ON "WebUsage"("organizationId", "day");
