-- How a prospect was reached (call, WhatsApp, email, in person) and whether anyone spoke to them. Additive, both optional.
ALTER TABLE "ProspectOutreach" ADD COLUMN "channel" TEXT;
ALTER TABLE "ProspectOutreach" ADD COLUMN "result" TEXT;
