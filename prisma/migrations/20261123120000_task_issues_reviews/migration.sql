-- Issues reported inside a task, the review record with its response clock, revision count, and the response time setting (additive)
ALTER TABLE "Task" ADD COLUMN "revisionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkingCalendar" ADD COLUMN "reviewResponseMinutes" INTEGER NOT NULL DEFAULT 5;

CREATE TABLE "TaskIssue" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskReview" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "comment" TEXT,
    "escalatedAt" TIMESTAMP(3),
    CONSTRAINT "TaskReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskIssue_taskId_status_idx" ON "TaskIssue"("taskId", "status");
CREATE INDEX "TaskIssue_status_createdAt_idx" ON "TaskIssue"("status", "createdAt");
CREATE INDEX "TaskReview_taskId_submittedAt_idx" ON "TaskReview"("taskId", "submittedAt");
CREATE INDEX "TaskReview_respondedAt_idx" ON "TaskReview"("respondedAt");

ALTER TABLE "TaskIssue" ADD CONSTRAINT "TaskIssue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
