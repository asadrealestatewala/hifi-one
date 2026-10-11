-- CreateTable
CREATE TABLE "AssistantLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "toolsUsed" TEXT[],
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantLog_organizationId_createdAt_idx" ON "AssistantLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantLog_userId_createdAt_idx" ON "AssistantLog"("userId", "createdAt");
