-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "convertedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
