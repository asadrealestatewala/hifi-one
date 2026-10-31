// Reconciles the initial staff and campaigns (src/lib/initial-records.ts). Safe in production and safe to rerun:
// it creates what is missing, fills empty fields, adds missing roles, and never overwrites, deletes or resets passwords.
//
//   npm run seed:initial                  reconcile
//   npm run seed:initial -- --setup-links also write one-time setup links (72 h) for these people who have
//                                         never signed in to .data/staff-setup-links.txt (git-ignored); needs APP_URL
//
// Contact numbers and CNICs are read from a private file, never from source code:
//   INITIAL_STAFF_FILE (default .data/initial-staff-private.json): { "Full Name": { "phone": "+92...", "identityNumber": "..." } }
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { createResetLink } from "../src/lib/accounts";
import { seedBaseline, syncPermissionsAndRoles } from "../src/lib/bootstrap";
import { INITIAL_STAFF, reconcileInitialRecords, type PrivateDetails } from "../src/lib/initial-records";

const db = new PrismaClient();
const orgs = await db.organization.findMany({ select: { id: true, name: true } });
const org = process.env.SEED_ORG_ID ? orgs.find((o) => o.id === process.env.SEED_ORG_ID) : orgs.length === 1 ? orgs[0] : undefined;
if (!org) {
  console.error(orgs.length === 0 ? "No organization yet. Complete /setup first." : "Several organizations exist. Set SEED_ORG_ID to choose one.");
  process.exit(1);
}
const file = process.env.INITIAL_STAFF_FILE ?? ".data/initial-staff-private.json";
const privateDetails: PrivateDetails = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
if (!fs.existsSync(file)) console.log(`No private details file at ${file}: contact numbers and CNICs are left empty.`);

await syncPermissionsAndRoles(db, org.id, { overwrite: false }); // new roles and permissions, without undoing edits made in the Roles screen
await seedBaseline(db, org.id); // upserts only: categories, stages, accounts, leave types
const r = await reconcileInitialRecords(db, { organizationId: org.id, privateDetails });
console.log(`Organization: ${org.name}`);
for (const [label, list] of [["Created", r.created], ["Completed", r.updated], ["Already up to date", r.unchanged], ["Campaigns created", r.campaignsCreated], ["Campaigns completed", r.campaignsUpdated], ["Warnings", r.warnings]] as const) {
  if (list.length) console.log(`${label}:\n  ${list.join("\n  ")}`);
}

if (process.argv.includes("--setup-links")) {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (!base) { console.error("Set APP_URL (for example https://erp.example.com) to create setup links."); process.exit(1); }
  const admin = await db.user.findFirst({ where: { organizationId: org.id, active: true, roles: { some: { role: { key: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } });
  const people = await db.user.findMany({ where: { organizationId: org.id, active: true, lastLoginAt: null, name: { in: INITIAL_STAFF.map((s) => s.name) } } });
  const lines = [`Setup links created ${new Date().toISOString()} (valid 72 hours, one use each). Send each to its owner yourself, then delete this file.`, ""];
  for (const u of people) lines.push(`${u.name}: ${base}/reset/${await createResetLink(db, { organizationId: org.id, userId: u.id, createdById: admin?.id ?? "system-seed", hours: 72 })}`);
  fs.mkdirSync(".data", { recursive: true });
  fs.writeFileSync(".data/staff-setup-links.txt", lines.join("\n") + "\n", { mode: 0o600 });
  console.log(`${people.length} setup link(s) written to .data/staff-setup-links.txt`);
}
await db.$disconnect();
