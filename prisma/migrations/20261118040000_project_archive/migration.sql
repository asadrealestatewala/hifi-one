-- Archive a closed project: hidden from project lists until restored. Additive only.
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "archivedById" TEXT;
