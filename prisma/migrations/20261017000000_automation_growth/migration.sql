-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "landingUrl" TEXT,
ADD COLUMN     "leadSourceId" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "approval" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT;

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'SCHEDULE',
    "runDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "summary" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "startedById" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assigneeId" TEXT,
    "projectId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "campaignId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "link" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "campaignId" TEXT,
    "assignMode" TEXT NOT NULL DEFAULT 'ROUND_ROBIN',
    "assigneeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rrIndex" INTEGER NOT NULL DEFAULT 0,
    "allowedOrigins" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "leadCount" INTEGER NOT NULL DEFAULT 0,
    "lastLeadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSpend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "results" INTEGER,
    "note" TEXT,
    "enteredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CONTRACT',
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "clientId" TEXT,
    "vendorId" TEXT,
    "templateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "signerName" TEXT,
    "signerEmail" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "signatureImage" TEXT,
    "declineReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_organizationId_key_startedAt_idx" ON "JobRun"("organizationId", "key", "startedAt");

-- CreateIndex
CREATE INDEX "SupportRequest_organizationId_status_idx" ON "SupportRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SupportRequest_clientId_status_idx" ON "SupportRequest"("clientId", "status");

-- CreateIndex
CREATE INDEX "SupportRequest_assigneeId_idx" ON "SupportRequest"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportRequest_organizationId_number_key" ON "SupportRequest"("organizationId", "number");

-- CreateIndex
CREATE INDEX "SupportMessage_requestId_idx" ON "SupportMessage"("requestId");

-- CreateIndex
CREATE INDEX "Deliverable_projectId_status_idx" ON "Deliverable"("projectId", "status");

-- CreateIndex
CREATE INDEX "Deliverable_organizationId_status_idx" ON "Deliverable"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Deliverable_campaignId_idx" ON "Deliverable"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_keyHash_key" ON "LeadSource"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_organizationId_name_key" ON "LeadSource"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CampaignSpend_campaignId_date_idx" ON "CampaignSpend"("campaignId", "date");

-- CreateIndex
CREATE INDEX "CampaignSpend_organizationId_date_idx" ON "CampaignSpend"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_organizationId_name_key" ON "DocumentTemplate"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Agreement_tokenHash_key" ON "Agreement"("tokenHash");

-- CreateIndex
CREATE INDEX "Agreement_organizationId_status_idx" ON "Agreement"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Agreement_organizationId_number_key" ON "Agreement"("organizationId", "number");

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_approval_idx" ON "TimeEntry"("organizationId", "approval");

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

