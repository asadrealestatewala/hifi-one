// The organization's initial staff and campaigns, reconciled into the database. Safe to run any number of times:
// - a person is found by registered contact number, else by exact name among staff; a campaign by name;
// - missing records are created, existing ones only get fields that are still empty and roles they lack;
// - nothing is overwritten, removed, or reset (no passwords are touched), so later edits in the app survive.
// Contact numbers and identity numbers are not kept in source code: they come from a private, git-ignored file.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { ensureCampaignCodes, saveCampaignRecord } from "./campaigns";
import { createStaff, ensureStaffProfile, normalizeCnic, normalizeStaffPhone } from "./staff";

export type InitialPerson = { name: string; designation: string; roleKeys: string[]; employmentType?: string };
export type PrivateDetails = Record<string, { phone?: string; identityNumber?: string }>;
export type InitialCampaign = { name: string; categoryName: string; description: string };

export const INITIAL_STAFF: InitialPerson[] = [
  { name: "Engr Asad B Zaman", designation: "CMO", roleKeys: ["SUPER_ADMIN", "CMO"] },
  { name: "Umair Qayyum", designation: "COO", roleKeys: ["SUPER_ADMIN", "COO"] },
  { name: "Naghma Riaz", designation: "Sales Agent", roleKeys: ["SALES_AGENT"] },
  { name: "Aqsa", designation: "HR Coordinator", roleKeys: ["HR_COORDINATOR"] },
  { name: "Fatima Rehman", designation: "Ads Manager", roleKeys: ["ADS_MANAGER"] },
  { name: "Faizan", designation: "AI Developer Intern", roleKeys: ["AI_DEVELOPER_INTERN"], employmentType: "INTERN" },
  { name: "Tahira Siraj", designation: "Project Manager", roleKeys: ["PROJECT_MANAGER"] },
  { name: "Areeba Ismail", designation: "Project Manager", roleKeys: ["PROJECT_MANAGER"] },
  { name: "Muhammad Jan", designation: "AI Developer Intern", roleKeys: ["AI_DEVELOPER_INTERN"], employmentType: "INTERN" },
];

// "SaaS" maps to the existing shared category rather than a second, competing list entry
export const SAAS_CATEGORY = "SaaS Products and Subscriptions";
export const INITIAL_CAMPAIGNS: InitialCampaign[] = [
  { name: "Classwell", categoryName: SAAS_CATEGORY, description: "An educational system ERP for school system management." },
  { name: "Agentify ERP", categoryName: SAAS_CATEGORY, description: "An ERP system for real estate management." },
  { name: "Podvet", categoryName: SAAS_CATEGORY, description: "A vet clinic management system." },
];

const SYSTEM = { id: "system-seed", isSuperAdmin: true, permissions: new Set<string>() };
export type ReconcileReport = { created: string[]; updated: string[]; unchanged: string[]; campaignsCreated: string[]; campaignsUpdated: string[]; warnings: string[] };

export async function reconcileInitialRecords(db: PrismaClient, p: { organizationId: string; staff?: InitialPerson[]; campaigns?: InitialCampaign[]; privateDetails?: PrivateDetails }): Promise<ReconcileReport> {
  const r: ReconcileReport = { created: [], updated: [], unchanged: [], campaignsCreated: [], campaignsUpdated: [], warnings: [] };
  const org = p.organizationId;
  for (const person of p.staff ?? INITIAL_STAFF) {
    const priv = p.privateDetails?.[person.name] ?? {};
    let phone: string | null = null;
    let cnic: string | null = null;
    try { phone = normalizeStaffPhone(priv.phone); } catch { r.warnings.push(`${person.name}: contact number ignored (not a valid number).`); }
    try { cnic = normalizeCnic(priv.identityNumber); } catch { r.warnings.push(`${person.name}: CNIC ignored (not 13 digits).`); }
    const byPhone = phone ? await db.user.findUnique({ where: { phone } }) : null;
    if (byPhone && byPhone.organizationId !== org) { r.warnings.push(`${person.name}: the number belongs to another organization; skipped.`); continue; }
    const byName = byPhone ? [] : await db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", name: { equals: person.name, mode: "insensitive" } } });
    if (byName.length > 1) { r.warnings.push(`${person.name}: more than one staff member has this name; nothing changed.`); continue; }
    const user = byPhone ?? byName[0] ?? null;
    if (!user) {
      await createStaff(db, {
        organizationId: org, actor: SYSTEM, roleKeys: person.roleKeys, canWriteSensitive: true, allowSameName: false,
        input: { name: person.name, phone, designation: person.designation, employmentType: person.employmentType ?? "FULL_TIME", identityNumber: cnic },
      });
      r.created.push(person.name);
      continue;
    }
    // Existing person: fill gaps only
    const changes: string[] = [];
    if (!user.phone && phone && !(await db.user.findUnique({ where: { phone } }))) { await db.user.update({ where: { id: user.id }, data: { phone } }); changes.push("contact number"); }
    let prof = await db.employeeProfile.findUnique({ where: { userId: user.id } });
    if (!prof) {
      prof = await ensureStaffProfile(db, { organizationId: org, userId: user.id });
      changes.push("staff record");
    }
    const profData: { designation?: string; identityNumber?: string; employmentType?: string } = {};
    if (!prof.designation) profData.designation = person.designation;
    if (!prof.identityNumber && cnic) profData.identityNumber = cnic;
    if (person.employmentType && !prof.designation) profData.employmentType = person.employmentType; // only for a record nobody has filled in yet
    if (Object.keys(profData).length) { await db.employeeProfile.update({ where: { id: prof.id }, data: profData }); changes.push(...Object.keys(profData)); }
    const roles = await db.role.findMany({ where: { organizationId: org, key: { in: person.roleKeys } } });
    if (roles.length !== person.roleKeys.length) r.warnings.push(`${person.name}: some roles do not exist yet; run the role sync first.`);
    const held = new Set((await db.userRole.findMany({ where: { userId: user.id } })).map((x) => x.roleId));
    const missing = roles.filter((x) => !held.has(x.id));
    if (missing.length) { await db.userRole.createMany({ data: missing.map((x) => ({ userId: user.id, roleId: x.id })), skipDuplicates: true }); changes.push(`roles ${missing.map((x) => x.key).join(", ")}`); }
    (changes.length ? r.updated : r.unchanged).push(changes.length ? `${person.name} (${changes.join(", ")})` : person.name);
  }

  for (const c of p.campaigns ?? INITIAL_CAMPAIGNS) {
    const cat = await db.serviceCategory.findFirst({ where: { organizationId: org, name: c.categoryName } });
    if (!cat) r.warnings.push(`${c.name}: category ${c.categoryName} not found; left empty.`);
    const found = await db.campaign.findFirst({ where: { organizationId: org, name: { equals: c.name, mode: "insensitive" } } });
    if (!found) {
      await saveCampaignRecord(db, { organizationId: org, actorId: SYSTEM.id, input: { name: c.name, categoryId: cat?.id ?? null, description: c.description } });
      r.campaignsCreated.push(c.name);
      continue;
    }
    const data: { categoryId?: string; description?: string } = {};
    if (!found.categoryId && cat) data.categoryId = cat.id;
    if (!found.description) data.description = c.description;
    if (Object.keys(data).length) { await db.campaign.update({ where: { id: found.id }, data }); r.campaignsUpdated.push(c.name); }
  }
  await ensureCampaignCodes(db, org);
  return r;
}
