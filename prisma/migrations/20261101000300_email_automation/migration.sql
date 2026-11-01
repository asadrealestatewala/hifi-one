-- Branded email templates, onboarding approval with an emailed code, and CRM follow-up sequences. Only adds tables.
-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SYSTEM',
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "buttonLabel" TEXT,
    "buttonUrl" TEXT,
    "highlights" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "codesSent" INTEGER NOT NULL DEFAULT 0,
    "lastCodeAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL DEFAULT 'NEW_LEAD',
    "leadSourceId" TEXT,
    "tag" TEXT,
    "stopOnStageChange" BOOLEAN NOT NULL DEFAULT true,
    "mailboxId" TEXT,
    "fromOwner" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "FollowUpStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stopReason" TEXT,
    "nextStep" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "stageIdAtStart" TEXT NOT NULL,
    "enrolledById" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "stoppedById" TEXT,

    CONSTRAINT "FollowUpEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpSend" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "subject" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailTemplate_organizationId_kind_idx" ON "EmailTemplate"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_organizationId_key_key" ON "EmailTemplate"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingRequest_userId_key" ON "OnboardingRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingRequest_tokenHash_key" ON "OnboardingRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "OnboardingRequest_organizationId_status_idx" ON "OnboardingRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FollowUpSequence_organizationId_active_idx" ON "FollowUpSequence"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpStep_sequenceId_position_key" ON "FollowUpStep"("sequenceId", "position");

-- CreateIndex
CREATE INDEX "FollowUpEnrollment_status_nextSendAt_idx" ON "FollowUpEnrollment"("status", "nextSendAt");

-- CreateIndex
CREATE INDEX "FollowUpEnrollment_organizationId_email_idx" ON "FollowUpEnrollment"("organizationId", "email");

-- CreateIndex
CREATE INDEX "FollowUpEnrollment_leadId_idx" ON "FollowUpEnrollment"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpEnrollment_sequenceId_leadId_key" ON "FollowUpEnrollment"("sequenceId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpSend_enrollmentId_position_key" ON "FollowUpSend"("enrollmentId", "position");

-- AddForeignKey
ALTER TABLE "FollowUpStep" ADD CONSTRAINT "FollowUpStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpStep" ADD CONSTRAINT "FollowUpStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEnrollment" ADD CONSTRAINT "FollowUpEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEnrollment" ADD CONSTRAINT "FollowUpEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSend" ADD CONSTRAINT "FollowUpSend_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "FollowUpEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The three new permissions, given to every Super Admin role so the screens work right after a deploy without
-- `npm run roles:sync`. Other roles get them from the role definitions when roles are synced. Safe to run twice.
INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('perm_email_templates_manage', 'email_templates.manage', 'Edit the branded email templates and preview them'),
  ('perm_followups_manage', 'followups.manage', 'Create and run CRM follow-up email sequences'),
  ('perm_onboarding_approve', 'onboarding.approve', 'Approve or reject new staff accounts before they can sign in')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE r."key" = 'SUPER_ADMIN' AND p."key" IN ('email_templates.manage', 'followups.manage', 'onboarding.approve')
ON CONFLICT DO NOTHING;
