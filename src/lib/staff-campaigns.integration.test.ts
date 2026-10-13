import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { createResetLink, consumeReset } from "./accounts";
import { syncPermissionsAndRoles, seedBaseline } from "./bootstrap";
import { CampaignError, campaignMetrics, campaignWhere, ensureCampaignCodes, linkProject, saveCampaignRecord, setCampaignArchived, setCampaignClients, setCampaignTeam } from "./campaigns";
import { INITIAL_STAFF, reconcileInitialRecords } from "./initial-records";
import { parseLoginIdentifier } from "./login-identifier";
import { StaffError, createStaff, ensureStaffProfile, markVerified, setStaffArchived, setStaffStatus, staffWhere, updateStaff } from "./staff";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string;
const superAdmin = { id: "root", isSuperAdmin: true, permissions: new Set<string>() };

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "CampaignMember","CampaignClient","Campaign","Task","ProjectMember","Project","Lead","PipelineStage","PasswordResetToken","Session","EmployeeProfile","UserRole","RolePermission","Role","Permission","User","Department","NumberSequence","ServiceCategory","Client","Account","LeaveType","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  await syncPermissionsAndRoles(db, org, { overwrite: true });
  await syncPermissionsAndRoles(db, other, { overwrite: true });
  await seedBaseline(db, org);
});
afterAll(async () => { await db.$disconnect(); });

describe("staff records", () => {
  it("creates a person with only a name, an automatic employee ID, and no usable password", async () => {
    const { user, profile } = await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "Only Name" }, canWriteSensitive: false });
    expect(user.email).toBeNull();
    expect(user.phone).toBeNull();
    expect(profile.employeeNo).toMatch(/^E-\d{4}$/);
    expect(user.mustChangePassword).toBe(true);
    expect(await bcrypt.compare("", user.passwordHash)).toBe(false);
  });

  it("refuses duplicate emails and numbers in any spelling, and asks before reusing a name", async () => {
    await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "Sara Khan", email: "Sara@Hifi.test", phone: "03001234567" }, canWriteSensitive: false });
    await expect(createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "Someone", email: "sara@hifi.test" }, canWriteSensitive: false })).rejects.toThrow(/already belongs to Sara Khan/);
    await expect(createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "Someone", phone: "+92 300 1234567" }, canWriteSensitive: false })).rejects.toThrow(/already belongs/);
    await expect(createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "sara khan" }, canWriteSensitive: false })).rejects.toThrow(/same name/);
    const twin = await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "sara khan" }, canWriteSensitive: false, allowSameName: true });
    expect(twin.profile.employeeNo).not.toBe("");
  });

  it("denies handing out access the creator does not hold", async () => {
    const hr = { id: "hr", isSuperAdmin: false, permissions: new Set(["hr.view", "hr.manage"]) };
    await expect(createStaff(db, { organizationId: org, actor: hr, roleKeys: ["SUPER_ADMIN"], input: { name: "Sneaky" }, canWriteSensitive: false })).rejects.toThrow(/Only a Super Admin/);
    await expect(createStaff(db, { organizationId: org, actor: hr, roleKeys: ["FINANCE_MANAGER"], input: { name: "Sneaky" }, canWriteSensitive: false })).rejects.toThrow(/do not hold/);
    await expect(createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["CLIENT"], input: { name: "Client Person" }, canWriteSensitive: false })).rejects.toThrow(StaffError);
  });

  it("writes CNIC only for callers with the sensitive permission, and keeps it when others edit", async () => {
    const { profile } = await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "Cnic Person", identityNumber: "1234512345671" }, canWriteSensitive: true });
    expect(profile.identityNumber).toBe("12345-1234567-1");
    const blind = await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "Blind Entry", identityNumber: "1234512345671" }, canWriteSensitive: false });
    expect(blind.profile.identityNumber).toBeNull();
    const r = await updateStaff(db, { organizationId: org, profileId: profile.id, input: { name: "Cnic Person", designation: "Sales Agent", identityNumber: "" }, canWriteSensitive: false });
    expect(r.changed).toContain("designation");
    expect((await db.employeeProfile.findUniqueOrThrow({ where: { id: profile.id } })).identityNumber).toBe("12345-1234567-1");
  });

  it("deactivates, exits, archives and restores without losing the record, and keeps a Super Admin", async () => {
    const { user, profile } = await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "Leaver One", email: "leaver@hifi.test" }, canWriteSensitive: false });
    await db.session.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await setStaffStatus(db, { organizationId: org, profileId: profile.id, status: "INACTIVE", actor: superAdmin });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).active).toBe(false);
    expect(await db.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    await setStaffArchived(db, { organizationId: org, profileId: profile.id, archived: true, actor: superAdmin });
    await expect(setStaffStatus(db, { organizationId: org, profileId: profile.id, status: "ACTIVE", actor: superAdmin })).rejects.toThrow(/archive/);
    expect(await db.employeeProfile.count({ where: await staffWhere(db, org, {}) })).toBeGreaterThan(0);
    expect(await db.employeeProfile.count({ where: { ...(await staffWhere(db, org, {})), id: profile.id } })).toBe(0);
    expect(await db.employeeProfile.count({ where: { ...(await staffWhere(db, org, { archived: true })), id: profile.id } })).toBe(1);
    await setStaffArchived(db, { organizationId: org, profileId: profile.id, archived: false, actor: superAdmin });
    await setStaffStatus(db, { organizationId: org, profileId: profile.id, status: "ACTIVE", actor: superAdmin });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).active).toBe(true);
    // the only Super Admin cannot be switched off
    const boss = await createStaff(db, { organizationId: other, actor: superAdmin, roleKeys: ["SUPER_ADMIN"], input: { name: "Only Boss" }, canWriteSensitive: false });
    await expect(setStaffStatus(db, { organizationId: other, profileId: boss.profile.id, status: "INACTIVE", actor: { ...superAdmin, id: "another" } })).rejects.toThrow(/at least one active Super Admin/);
  });

  it("marks verification only for details that exist, and a changed number is unverified again", async () => {
    const { profile } = await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "Verify Me", phone: "+923331112223" }, canWriteSensitive: false });
    await expect(markVerified(db, { organizationId: org, profileId: profile.id, what: "email" })).rejects.toThrow(/no email/);
    await markVerified(db, { organizationId: org, profileId: profile.id, what: "phone" });
    const u1 = await db.user.findFirstOrThrow({ where: { phone: "+923331112223" } });
    expect(u1.phoneVerifiedAt).not.toBeNull();
    await updateStaff(db, { organizationId: org, profileId: profile.id, input: { name: "Verify Me", phone: "+923331112224" }, canWriteSensitive: false });
    expect((await db.user.findUniqueOrThrow({ where: { id: u1.id } })).phoneVerifiedAt).toBeNull();
  });

  it("gives an account made elsewhere a staff record exactly once", async () => {
    const u = await db.user.create({ data: { organizationId: org, name: "Users Screen Person", email: "us@hifi.test", passwordHash: "x" } });
    const [a, b] = await Promise.all([ensureStaffProfile(db, { organizationId: org, userId: u.id }), ensureStaffProfile(db, { organizationId: org, userId: u.id })]);
    expect(a.id).toBe(b.id);
    await expect(ensureStaffProfile(db, { organizationId: other, userId: u.id })).rejects.toThrow(StaffError);
  });
});

describe("sign-in by email or phone", () => {
  it("finds the same account however the number is typed, and a set-up link sets the password", async () => {
    const { user } = await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["SALES_AGENT"], input: { name: "Phone Login", phone: "+923249990000" }, canWriteSensitive: false });
    for (const raw of ["03249990000", "+92 324 9990000", "0092 324 9990000"]) {
      const id = parseLoginIdentifier(raw)!;
      expect((await db.user.findUnique({ where: id.kind === "phone" ? { phone: id.value } : { email: id.value } }))?.id).toBe(user.id);
    }
    const token = await createResetLink(db, { organizationId: org, userId: user.id, createdById: "root", hours: 72 });
    await consumeReset(db, { token, password: "a-strong-password-1" });
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("a-strong-password-1", after.passwordHash)).toBe(true);
    expect(after.mustChangePassword).toBe(false);
    expect(after.emailVerifiedAt).toBeNull(); // an administrator's link proves nothing about email
  });
});

describe("campaigns", () => {
  it("numbers campaigns, uses the shared category list, and refuses bad links", async () => {
    const saas = await db.serviceCategory.findFirstOrThrow({ where: { organizationId: org, name: "SaaS Products and Subscriptions" } });
    const a = await saveCampaignRecord(db, { organizationId: org, actorId: "root", input: { name: "Alpha", categoryId: saas.id } });
    const b = await saveCampaignRecord(db, { organizationId: org, actorId: "root", input: { name: "Beta" } });
    expect(a.code).toMatch(/^CMP-\d{4}$/);
    expect(b.code).not.toBe(a.code);
    await expect(saveCampaignRecord(db, { organizationId: org, actorId: "root", input: { name: "Alpha" } })).rejects.toThrow(/already exists/);
    await expect(saveCampaignRecord(db, { organizationId: org, actorId: "root", input: { name: " ALPHA " } })).rejects.toThrow(/already exists/);
    const otherCat = await db.serviceCategory.create({ data: { organizationId: other, name: "Elsewhere" } });
    await expect(saveCampaignRecord(db, { organizationId: org, actorId: "root", input: { name: "Gamma", categoryId: otherCat.id } })).rejects.toThrow(/Unknown category/);
    await expect(saveCampaignRecord(db, { organizationId: org, actorId: "root", input: { name: "Gamma", budget: "lots" } })).rejects.toThrow(CampaignError);
  });

  it("links team, clients, projects and leads once each, and counts them without double-counting", async () => {
    const c = await saveCampaignRecord(db, { organizationId: org, actorId: "root", input: { name: "Linked" } });
    const p1 = (await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["PROJECT_MANAGER"], input: { name: "Team One" }, canWriteSensitive: false })).user;
    const p2 = (await createStaff(db, { organizationId: org, actor: superAdmin, roleKeys: ["ADS_MANAGER"], input: { name: "Team Two" }, canWriteSensitive: false })).user;
    await setCampaignTeam(db, { organizationId: org, id: c.id, userIds: [p1.id, p2.id, p1.id] });
    const r = await setCampaignTeam(db, { organizationId: org, id: c.id, userIds: [p2.id] });
    expect(r).toEqual({ added: [], removed: [p1.id] });
    const outsider = await db.user.create({ data: { organizationId: other, name: "Out", email: "out@other.test", passwordHash: "x" } });
    await expect(setCampaignTeam(db, { organizationId: org, id: c.id, userIds: [outsider.id] })).rejects.toThrow(CampaignError);
    const client = await db.client.create({ data: { organizationId: org, name: "Zara Foods", currency: "USD" } });
    await setCampaignClients(db, { organizationId: org, id: c.id, clientIds: [client.id, client.id] });
    const proj = await db.project.create({ data: { organizationId: org, number: "PRJ-1", name: "Launch site", managerId: p1.id } });
    await db.task.createMany({ data: [{ projectId: proj.id, title: "Design", status: "TODO" }, { projectId: proj.id, title: "Ship", status: "DONE" }] as never });
    await linkProject(db, { organizationId: org, projectId: proj.id, campaignId: c.id });
    const stage = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: org, isWon: true } });
    const stageNew = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: org, isWon: false } });
    await db.lead.createMany({ data: [{ organizationId: org, name: "L1", stageId: stageNew.id, campaignId: c.id }, { organizationId: org, name: "L2", stageId: stage.id, campaignId: c.id }] });
    const m = (await campaignMetrics(db, org, [c.id])).get(c.id)!;
    expect(m).toEqual({ leads: 2, won: 1, projects: 1, openTasks: 1, team: 1, clients: 1 });
    // the team member sees the campaign in their workload filter
    expect(await db.campaign.count({ where: campaignWhere(org, { memberId: p2.id }) })).toBe(1);
    // and the staff directory can be filtered by campaign or project
    expect(await db.employeeProfile.count({ where: await staffWhere(db, org, { campaignId: c.id }) })).toBe(1);
    expect(await db.employeeProfile.count({ where: await staffWhere(db, org, { projectId: proj.id }) })).toBe(1);
    // archive hides it from the default list but keeps every link
    await setCampaignArchived(db, { organizationId: org, id: c.id, archived: true });
    expect(await db.campaign.count({ where: { ...campaignWhere(org, {}), id: c.id } })).toBe(0);
    expect((await campaignMetrics(db, org, [c.id])).get(c.id)!.leads).toBe(2);
    await expect(linkProject(db, { organizationId: other, projectId: proj.id, campaignId: null })).rejects.toThrow(/Project not found/);
  });

  it("numbers older campaigns that had no code, once", async () => {
    await db.campaign.create({ data: { organizationId: org, name: "Legacy" } });
    expect(await ensureCampaignCodes(db, org)).toBe(1);
    expect(await ensureCampaignCodes(db, org)).toBe(0);
    expect((await db.campaign.findFirstOrThrow({ where: { organizationId: org, name: "Legacy" } })).code).toMatch(/^CMP-/);
  });
});

describe("initial records", () => {
  it("creates the named staff and campaigns, then reruns without duplicates, resets or overwrites", async () => {
    const priv = { "Engr Asad B Zaman": { phone: "+923007654321", identityNumber: "1234512345671" }, "Umair Qayyum": { phone: "+923001112223" } };
    const first = await reconcileInitialRecords(db, { organizationId: other, privateDetails: priv });
    expect(first.created).toHaveLength(INITIAL_STAFF.length);
    expect(first.campaignsCreated).toEqual(["Classwell", "Agentify ERP", "Podvet"]);
    const supers = await db.user.findMany({ where: { organizationId: other, roles: { some: { role: { key: "SUPER_ADMIN" } } } }, select: { name: true } });
    expect(supers.map((s) => s.name).sort()).toEqual(["Engr Asad B Zaman", "Only Boss", "Umair Qayyum"]);
    const asad = await db.user.findFirstOrThrow({ where: { phone: "+923007654321" }, include: { employeeProfile: true, roles: { include: { role: true } } } });
    expect(asad.email).toBeNull(); // never invented
    expect(asad.employeeProfile?.identityNumber).toBe("12345-1234567-1");
    expect(asad.roles.map((r) => r.role.key).sort()).toEqual(["CMO", "SUPER_ADMIN"]);
    const naghma = await db.user.findFirstOrThrow({ where: { organizationId: other, name: "Naghma Riaz" }, include: { employeeProfile: true } });
    expect(naghma.phone).toBeNull();
    expect(naghma.employeeProfile?.designation).toBe("Sales Agent");
    expect((await db.employeeProfile.findFirstOrThrow({ where: { organizationId: other, user: { name: "Faizan" } } })).employmentType).toBe("INTERN");

    const staffBefore = await db.user.count({ where: { organizationId: other, userType: "EMPLOYEE" } });
    // Later edits in the app, then a rerun
    await db.employeeProfile.update({ where: { userId: naghma.id }, data: { designation: "Senior Sales Agent" } });
    await db.user.update({ where: { id: asad.id }, data: { passwordHash: "set-by-asad" } });
    await db.campaign.updateMany({ where: { organizationId: other, name: "Podvet" }, data: { description: "Edited later" } });
    const second = await reconcileInitialRecords(db, { organizationId: other, privateDetails: priv });
    expect(second.created).toEqual([]);
    expect(second.campaignsCreated).toEqual([]);
    expect(await db.user.count({ where: { organizationId: other, userType: "EMPLOYEE" } })).toBe(staffBefore);
    expect(await db.campaign.count({ where: { organizationId: other } })).toBe(3);
    expect((await db.employeeProfile.findUniqueOrThrow({ where: { userId: naghma.id } })).designation).toBe("Senior Sales Agent");
    expect((await db.user.findUniqueOrThrow({ where: { id: asad.id } })).passwordHash).toBe("set-by-asad");
    expect((await db.campaign.findFirstOrThrow({ where: { organizationId: other, name: "Podvet" } })).description).toBe("Edited later");
    const codes = (await db.campaign.findMany({ where: { organizationId: other } })).map((c) => c.code);
    expect(new Set(codes).size).toBe(3);
  });
});
