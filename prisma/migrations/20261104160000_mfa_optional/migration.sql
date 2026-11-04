-- Two-step verification is optional (decision 62). Stop requiring it on any role; users who enabled it keep it.
-- An administrator can require it per role again on Roles & Permissions.
UPDATE "Role" SET "requireMfa" = false WHERE "requireMfa" = true;
