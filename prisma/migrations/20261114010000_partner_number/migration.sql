-- Partner ID: a sequential number per organization (shown as HPS-0001). Existing partners are numbered by approval date.
ALTER TABLE "Earner" ADD COLUMN "partnerNumber" INTEGER;
UPDATE "Earner" e SET "partnerNumber" = n.rn
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS rn FROM "Earner") n
WHERE e.id = n.id;
ALTER TABLE "Earner" ALTER COLUMN "partnerNumber" SET NOT NULL;
CREATE UNIQUE INDEX "Earner_organizationId_partnerNumber_key" ON "Earner"("organizationId", "partnerNumber");
