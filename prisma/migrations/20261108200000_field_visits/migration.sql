-- Field sales (decision 71): SaaS products, agent profiles, visits, and the product on a prospect. Additive only.
CREATE TABLE "SaasProduct" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "businessLabel" TEXT NOT NULL,
  "website" TEXT,
  "dailyVisitTarget" INTEGER NOT NULL DEFAULT 40,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaasProduct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SaasProduct_organizationId_code_key" ON "SaasProduct"("organizationId", "code");
CREATE INDEX "SaasProduct_organizationId_active_sortOrder_idx" ON "SaasProduct"("organizationId", "active", "sortOrder");

CREATE TABLE "SalesAgentProfile" (
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "productId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'OFFICE',
  "dailyVisitTarget" INTEGER,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesAgentProfile_pkey" PRIMARY KEY ("organizationId", "userId")
);
CREATE INDEX "SalesAgentProfile_organizationId_productId_kind_idx" ON "SalesAgentProfile"("organizationId", "productId", "kind");
ALTER TABLE "SalesAgentProfile" ADD CONSTRAINT "SalesAgentProfile_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Prospect"
  ADD COLUMN "productId" TEXT,
  ADD COLUMN "captureKind" TEXT,
  ADD COLUMN "lat" DECIMAL(9,6),
  ADD COLUMN "lng" DECIMAL(9,6),
  ADD COLUMN "lastVisitAt" TIMESTAMP(3),
  ADD COLUMN "lastOutcome" TEXT;
CREATE INDEX "Prospect_organizationId_productId_idx" ON "Prospect"("organizationId", "productId");
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProspectVisit" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "productId" TEXT,
  "agentId" TEXT NOT NULL,
  "visitedAt" TIMESTAMP(3) NOT NULL,
  "lat" DECIMAL(9,6),
  "lng" DECIMAL(9,6),
  "accuracyM" INTEGER,
  "locationSource" TEXT NOT NULL DEFAULT 'NONE',
  "outcome" TEXT NOT NULL,
  "reason" TEXT,
  "note" TEXT,
  "followUpOn" TEXT,
  "clientRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectVisit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProspectVisit_organizationId_agentId_clientRef_key" ON "ProspectVisit"("organizationId", "agentId", "clientRef");
CREATE INDEX "ProspectVisit_prospectId_visitedAt_idx" ON "ProspectVisit"("prospectId", "visitedAt");
CREATE INDEX "ProspectVisit_organizationId_agentId_visitedAt_idx" ON "ProspectVisit"("organizationId", "agentId", "visitedAt");
CREATE INDEX "ProspectVisit_organizationId_productId_visitedAt_idx" ON "ProspectVisit"("organizationId", "productId", "visitedAt");
ALTER TABLE "ProspectVisit" ADD CONSTRAINT "ProspectVisit_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectVisit" ADD CONSTRAINT "ProspectVisit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The three products every organization sells today. Managers can rename, add or switch them off in the app.
INSERT INTO "SaasProduct" ("id", "organizationId", "code", "name", "businessLabel", "website", "dailyVisitTarget", "sortOrder", "updatedAt")
SELECT 'prod_' || o."id" || '_' || v.code, o."id", v.code, v.name, v.label, v.site, 40, v.ord, CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES ('AGENTIFY', 'Agentify ERP', 'Real estate agency', 'https://agentifyerp.co', 0),
                   ('VELOCITY', 'Velocity ERP', 'Car dealer or workshop', 'https://velocityerp.co', 1),
                   ('PHARMIVO', 'Pharmivo', 'Pharmacy', NULL, 2)) AS v(code, name, label, site, ord)
ON CONFLICT ("organizationId", "code") DO NOTHING;

-- Permissions: register them, give them to Super Admin, and to the sales roles named in code. Safe to run twice.
INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('perm_field_capture', 'field.capture', 'Field sales: log visits to businesses with photos and location, as a field agent'),
  ('perm_field_review', 'field.review', 'Field sales: manage products, agent assignments and daily targets, and see every agent''s visits'),
  ('perm_prospector_schedule_demo', 'prospector.schedule_demo', 'Book the demo a business asked for during a visit or call, which turns the prospect into a lead')
ON CONFLICT ("key") DO NOTHING;

-- The Onboarding Specialist role, for the team that books demos, in every organization that does not have it yet.
INSERT INTO "Role" ("id", "organizationId", "key", "name", "isSystem", "requireMfa")
SELECT 'role_' || o."id" || '_onboarding', o."id", 'ONBOARDING_SPECIALIST', 'Onboarding Specialist', true, false
FROM "Organization" o
ON CONFLICT ("organizationId", "key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE (r."key" = 'SUPER_ADMIN' AND p."key" IN ('field.capture', 'field.review', 'prospector.schedule_demo'))
   OR (r."key" = 'SALES_MANAGER' AND p."key" IN ('field.capture', 'field.review', 'prospector.schedule_demo'))
   OR (r."key" = 'SALES_AGENT' AND p."key" = 'field.capture')
   OR (r."key" = 'SUCCESS_MANAGER' AND p."key" = 'prospector.schedule_demo')
   OR (r."key" = 'ONBOARDING_SPECIALIST' AND p."key" IN ('dashboard.view', 'crm.view', 'catalog.view', 'clients.view', 'prospector.schedule_demo', 'self.attendance', 'self.leave', 'self.payslip', 'self.expense', 'assistant.use', 'monitoring.own', 'meetings.use'))
ON CONFLICT DO NOTHING;
