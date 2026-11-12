-- Product details page: pitch information and the project that holds the product's brand assets. Additive.
ALTER TABLE "SaasProduct" ADD COLUMN "tagline" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "targetCustomers" TEXT,
ADD COLUMN "keyFeatures" TEXT,
ADD COLUMN "pricing" TEXT,
ADD COLUMN "demoUrl" TEXT,
ADD COLUMN "pitchNotes" TEXT,
ADD COLUMN "assetsProjectId" TEXT;
