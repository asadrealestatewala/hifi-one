-- AlterTable
ALTER TABLE "AcademyQuestion" ADD COLUMN     "finalOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Earner" ADD COLUMN     "academyDirectAccess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "directAccessAt" TIMESTAMP(3),
ADD COLUMN     "directAccessById" TEXT,
ADD COLUMN     "directAccessReason" TEXT;

-- AlterTable
ALTER TABLE "EarnerType" ADD COLUMN     "academyRequired" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AcademyTestAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "earnerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "questionIds" TEXT[],
    "answers" JSONB,
    "correctCount" INTEGER,
    "total" INTEGER NOT NULL,
    "scorePct" INTEGER,
    "passMark" INTEGER NOT NULL,
    "passed" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "declaredAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "certificateId" TEXT,

    CONSTRAINT "AcademyTestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademyTestAttempt_earnerId_productId_startedAt_idx" ON "AcademyTestAttempt"("earnerId", "productId", "startedAt");

-- CreateIndex
CREATE INDEX "AcademyTestAttempt_organizationId_startedAt_idx" ON "AcademyTestAttempt"("organizationId", "startedAt");

-- AddForeignKey
ALTER TABLE "AcademyTestAttempt" ADD CONSTRAINT "AcademyTestAttempt_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyTestAttempt" ADD CONSTRAINT "AcademyTestAttempt_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exclusive partners and Hifi's own sales agents get the certificate of authorisation by hand, not through the final test
UPDATE "EarnerType" SET "academyRequired" = false WHERE "key" IN ('EXCLUSIVE', 'SALES_AGENT');
