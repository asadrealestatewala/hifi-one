-- Brand kit and media library per client
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "clientId" TEXT,
    "colors" JSONB NOT NULL DEFAULT '[]',
    "headingFont" TEXT,
    "bodyFont" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "website" TEXT,
    "handle" TEXT,
    "logoCorner" TEXT NOT NULL DEFAULT 'TOP_RIGHT',
    "logoSizePct" INTEGER NOT NULL DEFAULT 14,
    "rules" TEXT,
    "logoFileId" TEXT,
    "logoLightFileId" TEXT,
    "iconFileId" TEXT,
    "suggestion" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrandKit_organizationId_ownerKey_key" ON "BrandKit"("organizationId", "ownerKey");

CREATE TABLE "MediaItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "clientId" TEXT,
    "fileId" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'General',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT,
    "uploadedById" TEXT NOT NULL,
    "byClient" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MediaItem_fileId_key" ON "MediaItem"("fileId");
CREATE INDEX "MediaItem_organizationId_ownerKey_folder_idx" ON "MediaItem"("organizationId", "ownerKey", "folder");
