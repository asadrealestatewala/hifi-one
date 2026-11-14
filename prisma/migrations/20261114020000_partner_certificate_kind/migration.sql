-- Partner certificates come in two kinds: TRAINING (no expiry) and AUTHORISATION (the official one, renewable).
-- Additive: existing certificates are official ones; expiresAt becomes optional for training certificates.
ALTER TABLE "PartnerCertificate" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'AUTHORISATION';
ALTER TABLE "PartnerCertificate" ALTER COLUMN "expiresAt" DROP NOT NULL;
CREATE INDEX "PartnerCertificate_earnerId_productId_kind_idx" ON "PartnerCertificate"("earnerId", "productId", "kind");
