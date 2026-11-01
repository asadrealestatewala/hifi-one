-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "purpose" TEXT,
    "ownerId" TEXT,
    "signature" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxMember" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canSend" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "counterpart" TEXT NOT NULL,
    "clientId" TEXT,
    "contactId" TEXT,
    "employeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "unread" INTEGER NOT NULL DEFAULT 0,
    "snippet" TEXT NOT NULL DEFAULT '',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "toAddresses" TEXT[],
    "ccAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attachmentNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "error" TEXT,
    "providerId" TEXT,
    "sentById" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_address_key" ON "Mailbox"("address");

-- CreateIndex
CREATE INDEX "Mailbox_organizationId_kind_idx" ON "Mailbox"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_organizationId_purpose_key" ON "Mailbox"("organizationId", "purpose");

-- CreateIndex
CREATE INDEX "MailboxMember_userId_idx" ON "MailboxMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxMember_mailboxId_userId_key" ON "MailboxMember"("mailboxId", "userId");

-- CreateIndex
CREATE INDEX "MailThread_mailboxId_status_lastMessageAt_idx" ON "MailThread"("mailboxId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MailThread_organizationId_clientId_idx" ON "MailThread"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "MailThread_organizationId_employeeId_idx" ON "MailThread"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "MailMessage_providerId_key" ON "MailMessage"("providerId");

-- CreateIndex
CREATE INDEX "MailMessage_threadId_createdAt_idx" ON "MailMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "MailMessage_mailboxId_messageId_idx" ON "MailMessage"("mailboxId", "messageId");

-- CreateIndex
CREATE INDEX "MailMessage_organizationId_createdAt_idx" ON "MailMessage"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "MailboxMember" ADD CONSTRAINT "MailboxMember_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailThread" ADD CONSTRAINT "MailThread_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

