-- Live screen view, off by default. Additive.
ALTER TABLE "MonitoringPolicy" ADD COLUMN "liveView" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "LiveView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "LiveView_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LiveView_subjectId_createdAt_idx" ON "LiveView"("subjectId", "createdAt");
CREATE INDEX "LiveView_viewerId_createdAt_idx" ON "LiveView"("viewerId", "createdAt");
