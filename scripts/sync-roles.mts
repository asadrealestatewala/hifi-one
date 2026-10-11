// After an upgrade that adds permissions: registers them and gives them to Super Admin.
// Other roles keep whatever was set in the Roles screen; grant new permissions to them there.
import { PrismaClient } from "@prisma/client";
import { syncPermissionsAndRoles } from "../src/lib/bootstrap";

const db = new PrismaClient();
for (const o of await db.organization.findMany()) await syncPermissionsAndRoles(db, o.id, { overwrite: false });
await db.$disconnect();
console.log("Permissions registered; Super Admin updated.");
