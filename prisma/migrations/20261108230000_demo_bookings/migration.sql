-- Field sales phase 3 (decision 73): demo bookings asked for at a visit, scheduled by the onboarding team. Additive only.
CREATE TABLE "DemoBooking" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "productId" TEXT,
  "requestedById" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "visitId" TEXT,
  "preferredNote" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "scheduledAt" TIMESTAMP(3),
  "scheduledById" TEXT,
  "trainerId" TEXT,
  "mode" TEXT,
  "note" TEXT,
  "leadId" TEXT,
  "closedAt" TIMESTAMP(3),
  "closedById" TEXT,
  "closeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DemoBooking_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DemoBooking_organizationId_status_requestedAt_idx" ON "DemoBooking"("organizationId", "status", "requestedAt");
CREATE INDEX "DemoBooking_organizationId_requestedById_status_idx" ON "DemoBooking"("organizationId", "requestedById", "status");
CREATE INDEX "DemoBooking_organizationId_trainerId_scheduledAt_idx" ON "DemoBooking"("organizationId", "trainerId", "scheduledAt");
CREATE INDEX "DemoBooking_prospectId_idx" ON "DemoBooking"("prospectId");
ALTER TABLE "DemoBooking" ADD CONSTRAINT "DemoBooking_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemoBooking" ADD CONSTRAINT "DemoBooking_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SaasProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
