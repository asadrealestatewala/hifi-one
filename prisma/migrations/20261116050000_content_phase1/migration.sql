-- Content calendar phase 1: captions per platform, first comment, hashtag groups. Additive only.
ALTER TABLE "ContentItem" ADD COLUMN "platformCopy" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ContentItem" ADD COLUMN "firstComment" TEXT;
ALTER TABLE "ContentVersion" ADD COLUMN "platformCopy" JSONB;
ALTER TABLE "ContentVersion" ADD COLUMN "firstComment" TEXT;

CREATE TABLE "HashtagGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HashtagGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HashtagGroup_organizationId_clientId_idx" ON "HashtagGroup"("organizationId", "clientId");
