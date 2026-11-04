-- Clout Leader (influencer post tracker). Additive only.
-- CreateTable
CREATE TABLE "CloutInfluencer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handles" JSONB NOT NULL DEFAULT '{}',
    "phone" TEXT,
    "notes" TEXT,
    "rate" DECIMAL(14,2),
    "rateCurrency" TEXT NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloutInfluencer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloutCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "clientId" TEXT,
    "refreshSeconds" INTEGER NOT NULL DEFAULT 900,
    "shareToken" TEXT,
    "lastRefreshAllAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloutCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloutPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cloutCampaignId" TEXT NOT NULL,
    "projectId" TEXT,
    "influencerId" TEXT,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LIVE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "trackingCode" TEXT,
    "trackingLink" TEXT,
    "caption" TEXT,
    "authorHandle" TEXT,
    "thumbnailUrl" TEXT,
    "postedAt" TIMESTAMP(3),
    "views" BIGINT NOT NULL DEFAULT 0,
    "likes" BIGINT NOT NULL DEFAULT 0,
    "comments" BIGINT NOT NULL DEFAULT 0,
    "shares" BIGINT,
    "saves" BIGINT,
    "viewsDelta" BIGINT NOT NULL DEFAULT 0,
    "likesDelta" BIGINT NOT NULL DEFAULT 0,
    "commentsDelta" BIGINT NOT NULL DEFAULT 0,
    "refreshSeconds" INTEGER,
    "effectiveSeconds" INTEGER NOT NULL DEFAULT 900,
    "fastLane" BOOLEAN NOT NULL DEFAULT false,
    "quotaFallback" BOOLEAN NOT NULL DEFAULT false,
    "nextCheckAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastManualAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveGone" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastProvider" TEXT,
    "unavailableAt" TIMESTAMP(3),
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloutPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloutSnapshot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" BIGINT NOT NULL,
    "likes" BIGINT NOT NULL,
    "comments" BIGINT NOT NULL,
    "shares" BIGINT,
    "saves" BIGINT,
    "provider" TEXT,

    CONSTRAINT "CloutSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloutProviderSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "primary" TEXT NOT NULL DEFAULT 'YTDLP',
    "fallback" TEXT,
    "failStreak" INTEGER NOT NULL DEFAULT 0,
    "backoffUntil" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloutProviderSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloutQuota" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "fastPosts" INTEGER NOT NULL DEFAULT 5,
    "minSeconds" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloutQuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloutInfluencer_organizationId_name_key" ON "CloutInfluencer"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CloutCampaign_campaignId_key" ON "CloutCampaign"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CloutCampaign_shareToken_key" ON "CloutCampaign"("shareToken");

-- CreateIndex
CREATE INDEX "CloutCampaign_organizationId_clientId_idx" ON "CloutCampaign"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "CloutPost_status_nextCheckAt_idx" ON "CloutPost"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "CloutPost_cloutCampaignId_idx" ON "CloutPost"("cloutCampaignId");

-- CreateIndex
CREATE INDEX "CloutPost_organizationId_platform_externalId_idx" ON "CloutPost"("organizationId", "platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "CloutPost_organizationId_canonicalUrl_key" ON "CloutPost"("organizationId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "CloutSnapshot_postId_takenAt_idx" ON "CloutSnapshot"("postId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "CloutProviderSetting_organizationId_platform_key" ON "CloutProviderSetting"("organizationId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "CloutQuota_organizationId_clientId_key" ON "CloutQuota"("organizationId", "clientId");

-- AddForeignKey
ALTER TABLE "CloutCampaign" ADD CONSTRAINT "CloutCampaign_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloutCampaign" ADD CONSTRAINT "CloutCampaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloutPost" ADD CONSTRAINT "CloutPost_cloutCampaignId_fkey" FOREIGN KEY ("cloutCampaignId") REFERENCES "CloutCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloutPost" ADD CONSTRAINT "CloutPost_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "CloutInfluencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloutPost" ADD CONSTRAINT "CloutPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloutSnapshot" ADD CONSTRAINT "CloutSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CloutPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloutQuota" ADD CONSTRAINT "CloutQuota_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One company-wide default quota row (clientId empty); Postgres treats empty values as distinct, so this index enforces it
CREATE UNIQUE INDEX "CloutQuota_default_key" ON "CloutQuota"("organizationId") WHERE "clientId" IS NULL;
