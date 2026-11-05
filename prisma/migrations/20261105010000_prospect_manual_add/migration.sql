-- Sales agents can add prospects they found themselves (referral, own contact, other). Additive: new nullable columns, and searchId may now be empty.
ALTER TABLE "Prospect" ALTER COLUMN "searchId" DROP NOT NULL;
ALTER TABLE "Prospect" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'SEARCH',
  ADD COLUMN "sourceLabel" TEXT,
  ADD COLUMN "sourceDetail" TEXT,
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "addedById" TEXT;
CREATE INDEX "Prospect_organizationId_addedById_idx" ON "Prospect"("organizationId", "addedById");
