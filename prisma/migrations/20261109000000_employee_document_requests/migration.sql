-- Employee documents: HR review marks on files, and requests from HR for a document. Additive only.
ALTER TABLE "StoredFile" ADD COLUMN "reviewStatus" TEXT;
ALTER TABLE "StoredFile" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "StoredFile" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "StoredFile" ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "StoredFile_organizationId_ownerType_reviewStatus_idx" ON "StoredFile"("organizationId", "ownerType", "reviewStatus");

CREATE TABLE "DocumentRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT,
    "dueOn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "fileId" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "DocumentRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentRequest_organizationId_status_idx" ON "DocumentRequest"("organizationId", "status");
CREATE INDEX "DocumentRequest_userId_status_idx" ON "DocumentRequest"("userId", "status");
