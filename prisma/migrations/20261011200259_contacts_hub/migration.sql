-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "contactId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "contactId" TEXT;

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "contactId" TEXT;

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PERSON',
    "title" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'LEAD',
    "industry" TEXT,
    "jobTitle" TEXT,
    "ownerId" TEXT,
    "followers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "website" TEXT,
    "phones" JSONB NOT NULL DEFAULT '[]',
    "emails" JSONB NOT NULL DEFAULT '[]',
    "primaryPhone" TEXT,
    "primaryEmail" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "timezone" TEXT,
    "preferredContact" TEXT,
    "source" TEXT,
    "campaignId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactActivity" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "outcome" TEXT,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_organizationId_kind_archived_idx" ON "Contact"("organizationId", "kind", "archived");

-- CreateIndex
CREATE INDEX "Contact_organizationId_primaryEmail_idx" ON "Contact"("organizationId", "primaryEmail");

-- CreateIndex
CREATE INDEX "Contact_organizationId_primaryPhone_idx" ON "Contact"("organizationId", "primaryPhone");

-- CreateIndex
CREATE INDEX "Contact_parentId_idx" ON "Contact"("parentId");

-- CreateIndex
CREATE INDEX "ContactActivity_contactId_createdAt_idx" ON "ContactActivity"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactActivity_actorId_createdAt_idx" ON "ContactActivity"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ContactActivity" ADD CONSTRAINT "ContactActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
