-- Publishing to Facebook and Instagram: connected accounts, sign-in sessions, one publication per post and platform. Additive only.
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "pageId" TEXT,
    "tokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "connectedById" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SocialAccount_organizationId_platform_externalId_key" ON "SocialAccount"("organizationId", "platform", "externalId");
CREATE INDEX "SocialAccount_organizationId_clientId_idx" ON "SocialAccount"("organizationId", "clientId");

CREATE TABLE "SocialConnectSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "userId" TEXT NOT NULL,
    "payloadEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialConnectSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SocialConnectSession_organizationId_userId_idx" ON "SocialConnectSession"("organizationId", "userId");

CREATE TABLE "ContentPublication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "containerId" TEXT,
    "externalPostId" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),
    "scheduledById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentPublication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContentPublication_itemId_platform_key" ON "ContentPublication"("itemId", "platform");
CREATE INDEX "ContentPublication_status_scheduledFor_idx" ON "ContentPublication"("status", "scheduledFor");
ALTER TABLE "ContentPublication" ADD CONSTRAINT "ContentPublication_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentPublication" ADD CONSTRAINT "ContentPublication_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
