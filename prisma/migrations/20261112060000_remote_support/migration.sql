-- Remote support requests, off by default. Additive.
ALTER TABLE "MonitoringPolicy" ADD COLUMN "remoteSupport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LiveView" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'VIEW';
ALTER TABLE "LiveView" ADD COLUMN "reason" TEXT;
