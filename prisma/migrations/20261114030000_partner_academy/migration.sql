-- CreateTable
CREATE TABLE "AcademyCourse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyLesson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "videoUrl" TEXT,
    "durationMinutes" INTEGER,
    "script" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quizSize" INTEGER NOT NULL DEFAULT 3,
    "isUpdate" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "options" TEXT[],
    "correct" INTEGER[],
    "explanation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyLessonProgress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "earnerId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "watchedPct" INTEGER NOT NULL DEFAULT 0,
    "watchedAt" TIMESTAMP(3),
    "quizPassedAt" TIMESTAMP(3),
    "quizScore" TEXT,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademyLessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademyQuizAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "earnerId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "questionIds" TEXT[],
    "answers" JSONB,
    "correctCount" INTEGER,
    "passed" BOOLEAN,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "AcademyQuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademyCourse_organizationId_status_idx" ON "AcademyCourse"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AcademyCourse_organizationId_productId_idx" ON "AcademyCourse"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "AcademyLesson_courseId_sortOrder_idx" ON "AcademyLesson"("courseId", "sortOrder");

-- CreateIndex
CREATE INDEX "AcademyQuestion_lessonId_status_idx" ON "AcademyQuestion"("lessonId", "status");

-- CreateIndex
CREATE INDEX "AcademyLessonProgress_organizationId_lessonId_idx" ON "AcademyLessonProgress"("organizationId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "AcademyLessonProgress_earnerId_lessonId_key" ON "AcademyLessonProgress"("earnerId", "lessonId");

-- CreateIndex
CREATE INDEX "AcademyQuizAttempt_earnerId_lessonId_startedAt_idx" ON "AcademyQuizAttempt"("earnerId", "lessonId", "startedAt");

-- AddForeignKey
ALTER TABLE "AcademyCourse" ADD CONSTRAINT "AcademyCourse_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyLesson" ADD CONSTRAINT "AcademyLesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyQuestion" ADD CONSTRAINT "AcademyQuestion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "AcademyLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyLessonProgress" ADD CONSTRAINT "AcademyLessonProgress_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyLessonProgress" ADD CONSTRAINT "AcademyLessonProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "AcademyLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyQuizAttempt" ADD CONSTRAINT "AcademyQuizAttempt_earnerId_fkey" FOREIGN KEY ("earnerId") REFERENCES "Earner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademyQuizAttempt" ADD CONSTRAINT "AcademyQuizAttempt_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "AcademyLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

