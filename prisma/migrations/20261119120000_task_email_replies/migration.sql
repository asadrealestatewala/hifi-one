-- AlterTable
ALTER TABLE "TaskComment" ADD COLUMN     "sourceEmailId" TEXT;

-- CreateTable
CREATE TABLE "TaskReplyAddress" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReplyAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskReplyAddress_token_key" ON "TaskReplyAddress"("token");

-- CreateIndex
CREATE UNIQUE INDEX "TaskReplyAddress_taskId_userId_key" ON "TaskReplyAddress"("taskId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskComment_sourceEmailId_key" ON "TaskComment"("sourceEmailId");

-- AddForeignKey
ALTER TABLE "TaskReplyAddress" ADD CONSTRAINT "TaskReplyAddress_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

