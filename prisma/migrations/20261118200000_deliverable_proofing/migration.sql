-- CreateTable
CREATE TABLE "DeliverableComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileId" TEXT,
    "authorId" TEXT NOT NULL,
    "fromClient" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "page" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliverableComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliverableComment_deliverableId_version_idx" ON "DeliverableComment"("deliverableId", "version");

-- AddForeignKey
ALTER TABLE "DeliverableComment" ADD CONSTRAINT "DeliverableComment_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

