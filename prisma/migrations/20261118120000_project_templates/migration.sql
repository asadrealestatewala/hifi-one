-- Project templates (additive): reusable plans, and which template a project started from.
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "body" JSONB NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectTemplate_organizationId_name_key" ON "ProjectTemplate"("organizationId", "name");

ALTER TABLE "Project" ADD COLUMN "templateId" TEXT;
