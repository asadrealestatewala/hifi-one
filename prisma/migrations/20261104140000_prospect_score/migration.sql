-- Prospector stage 4: the opportunity score kept on each prospect so lists can be sorted best first. Additive only.
ALTER TABLE "Prospect" ADD COLUMN "score" INTEGER;
ALTER TABLE "Prospect" ADD COLUMN "scoreService" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "scoreVersion" INTEGER;
ALTER TABLE "Prospect" ADD COLUMN "scoredAt" TIMESTAMP(3);
CREATE INDEX "Prospect_organizationId_score_idx" ON "Prospect"("organizationId", "score");
