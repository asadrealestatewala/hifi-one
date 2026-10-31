-- Job applications sent from the public website's careers pages (additive)
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" INTEGER NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "profileUrl" TEXT,
    "coverNote" TEXT,
    "cvFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "submissions" INTEGER NOT NULL DEFAULT 1,
    "sourceUrl" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobApplication_organizationId_jobId_email_key" ON "JobApplication"("organizationId", "jobId", "email");
CREATE INDEX "JobApplication_organizationId_status_createdAt_idx" ON "JobApplication"("organizationId", "status", "createdAt");
