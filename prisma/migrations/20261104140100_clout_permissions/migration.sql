-- Registers the Clout Leader permissions and gives them to the roles that should have them. Safe to run twice; other roles get them in the Roles screen.
INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('perm_clout_view', 'clout.view', 'Clout Leader: see and add influencer posts for the campaigns you own or belong to'),
  ('perm_clout_manage', 'clout.manage', 'Clout Leader: manage every campaign, influencer and post, refresh timers and exports'),
  ('perm_clout_settings', 'clout.settings', 'Clout Leader: choose data providers and set fast-lane quotas per client (Super Admin only)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE (p."key" = 'clout.settings' AND r."key" = 'SUPER_ADMIN')
   OR (p."key" = 'clout.manage' AND r."key" IN ('SUPER_ADMIN', 'SALES_MANAGER', 'MARKETING_DIRECTOR', 'CMO'))
   OR (p."key" = 'clout.view' AND r."key" IN ('SUPER_ADMIN', 'SALES_MANAGER', 'MARKETING_DIRECTOR', 'CMO', 'COO', 'CEO', 'SALES_AGENT', 'PROJECT_MANAGER', 'ADS_MANAGER', 'ADS_EXPERT'))
ON CONFLICT DO NOTHING;
