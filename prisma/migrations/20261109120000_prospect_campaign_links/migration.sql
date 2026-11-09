-- Campaign chosen when an agent adds a prospect, carried to the lead on conversion; the lead keeps the website and Google Maps link as fields. Additive, all optional.
ALTER TABLE "Prospect" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "website" TEXT;
ALTER TABLE "Lead" ADD COLUMN "mapsUrl" TEXT;
