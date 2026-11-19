-- CreateTable
CREATE TABLE "TaskTimer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "TaskTimer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskTimer_userId_key" ON "TaskTimer"("userId");

-- CreateIndex
CREATE INDEX "TaskTimer_organizationId_idx" ON "TaskTimer"("organizationId");

-- CreateIndex
CREATE INDEX "TaskTimer_taskId_idx" ON "TaskTimer"("taskId");

