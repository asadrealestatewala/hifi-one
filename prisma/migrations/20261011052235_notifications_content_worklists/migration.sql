-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "platform" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "copy" TEXT NOT NULL,
    "hashtags" TEXT,
    "plannedDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "copy" TEXT NOT NULL,
    "hashtags" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentEvent" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressedContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressedContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worklist" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,
    "assignedToId" TEXT,
    "targetDate" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Worklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorklistRow" (
    "id" TEXT NOT NULL,
    "worklistId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "raw" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "duplicateLeadId" TEXT,
    "convertedLeadId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorklistRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ContentItem_organizationId_status_idx" ON "ContentItem"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ContentItem_clientId_status_idx" ON "ContentItem"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_itemId_version_key" ON "ContentVersion"("itemId", "version");

-- CreateIndex
CREATE INDEX "ContentEvent_itemId_createdAt_idx" ON "ContentEvent"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "SuppressedContact_organizationId_email_idx" ON "SuppressedContact"("organizationId", "email");

-- CreateIndex
CREATE INDEX "SuppressedContact_organizationId_phone_idx" ON "SuppressedContact"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "WorklistRow_worklistId_status_idx" ON "WorklistRow"("worklistId", "status");

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentEvent" ADD CONSTRAINT "ContentEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorklistRow" ADD CONSTRAINT "WorklistRow_worklistId_fkey" FOREIGN KEY ("worklistId") REFERENCES "Worklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
