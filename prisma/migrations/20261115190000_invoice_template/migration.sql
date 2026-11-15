-- Each invoice can use its own PDF layout; empty means the company default template.
ALTER TABLE "Invoice" ADD COLUMN "templateKey" TEXT;
