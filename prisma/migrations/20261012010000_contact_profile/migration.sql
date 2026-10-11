-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "birthday" TEXT,
ADD COLUMN     "shipAddressLine" TEXT,
ADD COLUMN     "shipCity" TEXT,
ADD COLUMN     "shipCountry" TEXT,
ADD COLUMN     "shipPostalCode" TEXT,
ADD COLUMN     "shipState" TEXT,
ADD COLUMN     "social" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "utm" JSONB NOT NULL DEFAULT '{}';
