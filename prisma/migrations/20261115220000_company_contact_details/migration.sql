-- Company contact details as given by the owner on 2026-11-15, shown on every document.
-- Issued invoices keep the details frozen when they were issued; this only changes what new documents show.
UPDATE "CompanyProfile" SET
  "website" = 'www.hifimarketing.co',
  "email" = 'hello@hifimarketing.co',
  "localUan" = '(92) 316 8080801',
  "globalUan" = '+1 (778) 652-1616',
  "salesCentre" = 'Unit # 04 Mezzanine Floor, Soan Garden, Islamabad',
  "registeredOffice" = '7901 4TH ST N # 24416, ST. PETERSBURG, FL 33702',
  "version" = "version" + 1,
  "updatedAt" = NOW()
WHERE "isDefault" = true;
