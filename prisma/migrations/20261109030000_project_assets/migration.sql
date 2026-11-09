-- Project asset library (brand guides, logos, videos, creatives) with public preview links. Additive only.
CREATE TABLE "ProjectAsset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "folder" TEXT NOT NULL DEFAULT 'General',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "tags" TEXT[],
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ProjectAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectAsset_projectId_folder_idx" ON "ProjectAsset"("projectId", "folder");
CREATE INDEX "ProjectAsset_organizationId_idx" ON "ProjectAsset"("organizationId");
ALTER TABLE "ProjectAsset" ADD CONSTRAINT "ProjectAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectAssetShare" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "folder" TEXT,
  "label" TEXT,
  "token" TEXT NOT NULL,
  "passwordHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectAssetShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectAssetShare_token_key" ON "ProjectAssetShare"("token");
CREATE INDEX "ProjectAssetShare_projectId_idx" ON "ProjectAssetShare"("projectId");
ALTER TABLE "ProjectAssetShare" ADD CONSTRAINT "ProjectAssetShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
