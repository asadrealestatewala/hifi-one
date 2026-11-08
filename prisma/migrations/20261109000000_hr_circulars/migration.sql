-- HR circulars: a message to all staff, some roles or chosen people, shown as a notification and a popup until acknowledged. Additive only.
CREATE TABLE "Circular" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'GENERAL',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audience" TEXT NOT NULL DEFAULT 'ALL',
  "audienceLabel" TEXT,
  "sentById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Circular_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Circular_organizationId_createdAt_idx" ON "Circular"("organizationId", "createdAt");

CREATE TABLE "CircularRecipient" (
  "id" TEXT NOT NULL,
  "circularId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ackAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CircularRecipient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CircularRecipient_circularId_userId_key" ON "CircularRecipient"("circularId", "userId");
CREATE INDEX "CircularRecipient_userId_ackAt_idx" ON "CircularRecipient"("userId", "ackAt");
ALTER TABLE "CircularRecipient" ADD CONSTRAINT "CircularRecipient_circularId_fkey" FOREIGN KEY ("circularId") REFERENCES "Circular"("id") ON DELETE CASCADE ON UPDATE CASCADE;
