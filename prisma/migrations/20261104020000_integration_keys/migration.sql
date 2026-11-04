-- Integration keys entered by a Super Admin in the app. Additive only.
CREATE TABLE "IntegrationKey" (
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationKey_pkey" PRIMARY KEY ("organizationId","provider")
);

-- Registers the permission and gives it to Super Admin only. Safe to run twice.
INSERT INTO "Permission" ("id", "key", "description")
VALUES ('perm_integrations_manage', 'integrations.manage', 'Enter, replace and clear the API keys of outside services (Super Admin only)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE r."key" = 'SUPER_ADMIN' AND p."key" = 'integrations.manage'
ON CONFLICT DO NOTHING;
