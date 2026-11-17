-- CreateTable
CREATE TABLE "SolutionFeedKey" (
    "productId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "lastReportAt" TIMESTAMP(3),

    CONSTRAINT "SolutionFeedKey_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "SolutionWorkspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT,
    "linkedById" TEXT,
    "linkedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "planName" TEXT,
    "paidUntil" TEXT,
    "activeUsers" INTEGER,
    "units" INTEGER,
    "unitLabel" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "appVersion" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolutionWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolutionWorkspace_organizationId_clientId_idx" ON "SolutionWorkspace"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "SolutionWorkspace_organizationId_productId_status_idx" ON "SolutionWorkspace"("organizationId", "productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SolutionWorkspace_productId_externalId_key" ON "SolutionWorkspace"("productId", "externalId");

-- AddForeignKey
ALTER TABLE "SolutionFeedKey" ADD CONSTRAINT "SolutionFeedKey_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolutionWorkspace" ADD CONSTRAINT "SolutionWorkspace_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolutionWorkspace" ADD CONSTRAINT "SolutionWorkspace_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
