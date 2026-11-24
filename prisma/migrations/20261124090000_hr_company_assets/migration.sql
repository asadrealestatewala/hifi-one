-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "condition" TEXT NOT NULL DEFAULT 'GOOD',
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "inBooks" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "writeOffReason" TEXT;

-- AlterTable
ALTER TABLE "AssetAssignment" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "conditionIn" TEXT,
ADD COLUMN     "conditionOut" TEXT,
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "returnNote" TEXT,
ADD COLUMN     "returnedById" TEXT;

-- CreateIndex
CREATE INDEX "AssetAssignment_userId_returnedAt_idx" ON "AssetAssignment"("userId", "returnedAt");


-- Permission: look after company items (record outside the books, issue, take back). Registered here and given to the
-- roles that have it in code, so existing organizations get it without editing roles by hand. Safe to run twice.
INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('perm_assets_custody', 'assets.custody', 'Record company items, issue them to staff and take them back')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE r."key" IN ('SUPER_ADMIN', 'HR_MANAGER', 'HR_COORDINATOR', 'FINANCE_MANAGER', 'ACCOUNTANT') AND p."key" = 'assets.custody'
ON CONFLICT DO NOTHING;
