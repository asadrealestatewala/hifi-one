-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentName" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "providerMessageId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailMessage_organizationId_createdAt_idx" ON "EmailMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_relatedType_relatedId_idx" ON "EmailMessage"("relatedType", "relatedId");
