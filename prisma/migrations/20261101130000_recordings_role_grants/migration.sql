-- Gives meetings.recordings to the roles whose definition in code includes it (Project Manager, Success Manager, CEO).
-- The earlier migration registered the permission, so `npm run roles:sync` no longer treats it as new and would skip these roles.
-- Safe to run twice; roles can still be changed afterwards on the Roles screen.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r, "Permission" p
WHERE r."key" IN ('PROJECT_MANAGER', 'SUCCESS_MANAGER', 'CEO') AND p."key" = 'meetings.recordings'
ON CONFLICT DO NOTHING;
