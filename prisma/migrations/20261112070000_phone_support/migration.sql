-- Company-owned phone flag and phone target for support requests. Additive.
ALTER TABLE "PushDevice" ADD COLUMN "companyOwned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PushDevice" ADD COLUMN "label" TEXT;
ALTER TABLE "LiveView" ADD COLUMN "deviceId" TEXT;
