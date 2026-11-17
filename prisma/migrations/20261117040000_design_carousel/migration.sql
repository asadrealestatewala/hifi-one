-- AlterTable
ALTER TABLE "ContentDesign" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'SINGLE',
ADD COLUMN     "slides" JSONB;
