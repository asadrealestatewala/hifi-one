-- CreateTable
CREATE TABLE "QuestSettings" (
    "organizationId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestSettings_pkey" PRIMARY KEY ("organizationId")
);
