-- Prospector stage 1: searches, prospects, the outside-call ledger and search limits. Additive only.
CREATE TABLE "ProspectSearch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProspectSearch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "mapsUrl" TEXT,
    "rating" DECIMAL(2,1),
    "ratingCount" INTEGER,
    "primaryType" TEXT,
    "businessStatus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "leadId" TEXT,
    "placeFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiCall" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "userId" TEXT,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectorSettings" (
    "organizationId" TEXT NOT NULL,
    "defaultDailySearches" INTEGER NOT NULL DEFAULT 10,
    CONSTRAINT "ProspectorSettings_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "ProspectorUserLimit" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailySearches" INTEGER NOT NULL,
    CONSTRAINT "ProspectorUserLimit_pkey" PRIMARY KEY ("organizationId","userId")
);

CREATE INDEX "ProspectSearch_organizationId_createdAt_idx" ON "ProspectSearch"("organizationId", "createdAt");
CREATE INDEX "ProspectSearch_organizationId_userId_createdAt_idx" ON "ProspectSearch"("organizationId", "userId", "createdAt");
CREATE UNIQUE INDEX "Prospect_organizationId_placeId_key" ON "Prospect"("organizationId", "placeId");
CREATE INDEX "Prospect_organizationId_status_createdAt_idx" ON "Prospect"("organizationId", "status", "createdAt");
CREATE INDEX "Prospect_organizationId_assignedToId_idx" ON "Prospect"("organizationId", "assignedToId");
CREATE INDEX "Prospect_searchId_idx" ON "Prospect"("searchId");
CREATE INDEX "ApiCall_organizationId_provider_createdAt_idx" ON "ApiCall"("organizationId", "provider", "createdAt");

ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "ProspectSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Registers the Prospector permissions, gives them to Super Admin and gives Sales Managers the same. Other roles get them in the Roles screen. Safe to run twice.
INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('perm_prospector_use', 'prospector.use', 'Run Prospector searches that find new businesses (uses the Google budget)'),
  ('perm_prospector_manage', 'prospector.manage', 'Set Prospector daily search limits per person')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE r."key" IN ('SUPER_ADMIN', 'SALES_MANAGER') AND p."key" IN ('prospector.use', 'prospector.manage')
ON CONFLICT DO NOTHING;
