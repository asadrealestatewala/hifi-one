-- CreateTable
CREATE TABLE "MonitoringPolicy" (
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "policyText" TEXT NOT NULL DEFAULT '',
    "trackActivity" BOOLEAN NOT NULL DEFAULT true,
    "trackApps" BOOLEAN NOT NULL DEFAULT false,
    "screenshots" BOOLEAN NOT NULL DEFAULT false,
    "screenshotIntervalMin" INTEGER NOT NULL DEFAULT 10,
    "idleThresholdMin" INTEGER NOT NULL DEFAULT 5,
    "workStart" TEXT NOT NULL DEFAULT '09:00',
    "workEnd" TEXT NOT NULL DEFAULT '18:00',
    "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringPolicy_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "PolicyAck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "projectId" TEXT,
    "taskId" TEXT,
    "note" TEXT,

    CONSTRAINT "WorkSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkBreak" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "WorkBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityBucket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "idleSeconds" INTEGER NOT NULL DEFAULT 0,
    "keyCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'WEB',

    CONSTRAINT "ActivityBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AppUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "AppCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "os" TEXT,
    "agentVersion" TEXT,
    "tokenHash" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MonitorDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screenshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "disputeNote" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Screenshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringAccess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetCorrection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requestedMinutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAck_userId_version_key" ON "PolicyAck"("userId", "version");

-- CreateIndex
CREATE INDEX "WorkSession_userId_startedAt_idx" ON "WorkSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkSession_organizationId_startedAt_idx" ON "WorkSession"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkBreak_sessionId_idx" ON "WorkBreak"("sessionId");

-- CreateIndex
CREATE INDEX "ActivityBucket_organizationId_bucketStart_idx" ON "ActivityBucket"("organizationId", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityBucket_userId_bucketStart_source_key" ON "ActivityBucket"("userId", "bucketStart", "source");

-- CreateIndex
CREATE INDEX "AppUsage_organizationId_day_idx" ON "AppUsage"("organizationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AppUsage_userId_day_name_key" ON "AppUsage"("userId", "day", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AppCategory_organizationId_pattern_key" ON "AppCategory"("organizationId", "pattern");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorDevice_tokenHash_key" ON "MonitorDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "MonitorDevice_userId_idx" ON "MonitorDevice"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentCode_codeHash_key" ON "EnrollmentCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Screenshot_storageKey_key" ON "Screenshot"("storageKey");

-- CreateIndex
CREATE INDEX "Screenshot_userId_capturedAt_idx" ON "Screenshot"("userId", "capturedAt");

-- CreateIndex
CREATE INDEX "Screenshot_organizationId_capturedAt_idx" ON "Screenshot"("organizationId", "capturedAt");

-- CreateIndex
CREATE INDEX "MonitoringAccess_subjectId_createdAt_idx" ON "MonitoringAccess"("subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "TimesheetCorrection_organizationId_status_idx" ON "TimesheetCorrection"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TimesheetCorrection_userId_day_idx" ON "TimesheetCorrection"("userId", "day");

-- AddForeignKey
ALTER TABLE "WorkBreak" ADD CONSTRAINT "WorkBreak_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
