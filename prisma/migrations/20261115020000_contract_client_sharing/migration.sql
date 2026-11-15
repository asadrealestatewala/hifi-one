-- Contracts can be shown to the client in their portal (off by default).
ALTER TABLE "Contract" ADD COLUMN "sharedWithClient" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contract" ADD COLUMN "sharedAt" TIMESTAMP(3);
