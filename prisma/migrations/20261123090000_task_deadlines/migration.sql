-- Task deadlines with a time of day, and when a task was assigned and started (additive)
ALTER TABLE "Task" ADD COLUMN "dueTime" TEXT;
ALTER TABLE "Task" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "startedAt" TIMESTAMP(3);
