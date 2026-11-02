-- AlterTable
ALTER TABLE "Department" ADD COLUMN "description" TEXT,
ADD COLUMN "headId" TEXT;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_headId_fkey" FOREIGN KEY ("headId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
