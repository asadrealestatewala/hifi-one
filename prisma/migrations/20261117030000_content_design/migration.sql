-- Branded designs on posts
CREATE TABLE "ContentDesign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "sizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "label" TEXT,
    "headline" TEXT NOT NULL,
    "sub" TEXT,
    "cta" TEXT,
    "photoFileId" TEXT,
    "outputFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentDesign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContentDesign_itemId_key" ON "ContentDesign"("itemId");
CREATE INDEX "ContentDesign_organizationId_idx" ON "ContentDesign"("organizationId");
