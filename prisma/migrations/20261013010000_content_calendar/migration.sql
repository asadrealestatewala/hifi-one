-- Content calendar: several platforms per post, post type, time, and posts without a client
ALTER TABLE "ContentItem" ADD COLUMN "plannedTime" TEXT;
ALTER TABLE "ContentItem" ADD COLUMN "postType" TEXT NOT NULL DEFAULT 'STATIC';
ALTER TABLE "ContentItem" ADD COLUMN "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ContentItem" ALTER COLUMN "clientId" DROP NOT NULL;
UPDATE "ContentItem" SET "platforms" = ARRAY["platform"] WHERE cardinality("platforms") = 0;
