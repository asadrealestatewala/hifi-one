-- Subtasks, task dependencies and recurring tasks
ALTER TABLE "Task" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Task" ADD COLUMN "blockedBy" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Task" ADD COLUMN "recurrence" TEXT;
ALTER TABLE "Task" ADD COLUMN "recurredFromId" TEXT;
CREATE UNIQUE INDEX "Task_recurredFromId_key" ON "Task"("recurredFromId");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
