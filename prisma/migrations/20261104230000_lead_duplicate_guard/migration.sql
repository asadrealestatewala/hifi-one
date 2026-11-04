-- Duplicate lead protection (decision 65). Additive only: two new tables, no existing data is changed or deleted.
CREATE TABLE "CrmSettings" (
  "organizationId" TEXT NOT NULL,
  "duplicateMode" TEXT NOT NULL DEFAULT 'BLOCK',
  "defaultCountry" TEXT NOT NULL DEFAULT 'PK',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmSettings_pkey" PRIMARY KEY ("organizationId")
);
CREATE TABLE "LeadKey" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  CONSTRAINT "LeadKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeadKey_organizationId_kind_key_key" ON "LeadKey"("organizationId", "kind", "key");
CREATE INDEX "LeadKey_leadId_idx" ON "LeadKey"("leadId");
ALTER TABLE "LeadKey" ADD CONSTRAINT "LeadKey_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
