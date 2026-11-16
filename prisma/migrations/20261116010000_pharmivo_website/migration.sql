-- Gives Pharmivo its website where none is set, so the public Partner Stack page links to it. Existing links are left alone.
UPDATE "SaasProduct" SET "website" = 'https://pharmivo.hifimarketing.co' WHERE "code" = 'PHARMIVO' AND ("website" IS NULL OR "website" = '');
