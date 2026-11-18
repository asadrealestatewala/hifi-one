-- Task labels (additive): a shared list per organization, and the ids on each task.
ALTER TABLE "Task" ADD COLUMN "labelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "TaskLabel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskLabel_organizationId_name_key" ON "TaskLabel"("organizationId", "name");
