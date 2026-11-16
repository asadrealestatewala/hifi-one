-- Proposal sections and layout on quotations (additive, all nullable)
ALTER TABLE "Quote" ADD COLUMN "title" TEXT;
ALTER TABLE "Quote" ADD COLUMN "introduction" TEXT;
ALTER TABLE "Quote" ADD COLUMN "scope" TEXT;
ALTER TABLE "Quote" ADD COLUMN "timeline" TEXT;
ALTER TABLE "Quote" ADD COLUMN "templateKey" TEXT;
