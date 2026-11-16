-- AI monthly content plans: client content profile, AI run log, AI marker on posts. Additive only.
ALTER TABLE "ContentItem" ADD COLUMN "aiRunId" TEXT;

CREATE TABLE "ClientContentProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "brandVoice" TEXT,
    "audience" TEXT,
    "about" TEXT,
    "topics" TEXT,
    "avoid" TEXT,
    "languages" TEXT,
    "hashtagRules" TEXT,
    "visualStyle" TEXT,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monthlyCapUsd" DECIMAL(8,2) NOT NULL DEFAULT 10,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientContentProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientContentProfile_clientId_key" ON "ClientContentProfile"("clientId");
CREATE INDEX "ClientContentProfile_organizationId_idx" ON "ClientContentProfile"("organizationId");

CREATE TABLE "ContentAiRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "planMonth" TEXT,
    "itemId" TEXT,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    CONSTRAINT "ContentAiRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContentAiRun_clientId_month_idx" ON "ContentAiRun"("clientId", "month");
CREATE INDEX "ContentAiRun_organizationId_createdAt_idx" ON "ContentAiRun"("organizationId", "createdAt");
