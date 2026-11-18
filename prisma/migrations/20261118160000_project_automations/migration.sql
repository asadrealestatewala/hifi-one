-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "sourceLeadId" TEXT;

-- AlterTable
ALTER TABLE "ProjectTemplate" ADD COLUMN     "defaultManagerId" TEXT,
ADD COLUMN     "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "roleDefaults" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE UNIQUE INDEX "Project_sourceLeadId_key" ON "Project"("sourceLeadId");

