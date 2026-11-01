-- Registers the mail.manage permission and gives it to every Super Admin role, so Settings > Mailboxes works right after a
-- deploy without a separate `npm run roles:sync`. Other roles keep what the Roles screen says. Safe to run twice.
INSERT INTO "Permission" ("id", "key", "description")
VALUES ('perm_mail_manage', 'mail.manage', 'Create company and employee mailboxes and choose who can use each one (does not open anyone''s mail)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE r."key" = 'SUPER_ADMIN' AND p."key" = 'mail.manage'
ON CONFLICT DO NOTHING;
