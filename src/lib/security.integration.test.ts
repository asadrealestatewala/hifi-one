// First-run setup, MFA, password reset, user administration and roles against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SetupError, firstSetup, needsSetup } from "./bootstrap";
import { beginMfaSetup, checkSecondFactor, confirmMfaSetup, disableMfa, regenerateRecoveryCodes } from "./mfa";
import { AccountError, adminResetMfa, consumeReset, createResetLink, createRole, createUser, deleteRole, resetInfo, setRolePermissions, setUserActive, setUserRoles, type Actor } from "./accounts";
import { decryptSecret, totp } from "./totp";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const APP_SECRET = "test-app-secret-test-app-secret-1234";

let org: string;
let admin: string;
let adminEmail: string;
const superActor = (id: string): Actor => ({ id, isSuperAdmin: true, permissions: new Set() });

async function wipe() {
  await db.$executeRawUnsafe('TRUNCATE "PasswordResetToken","Session","AuditLog","UserRole","RolePermission","Permission","Role","User","Branch","Department","CompanyProfile","Account","PipelineStage","ServiceCategory","LeaveType","Organization" CASCADE');
}

beforeAll(wipe);
afterAll(async () => {
  await db.$disconnect();
});

describe("first-run setup", () => {
  const input = { companyName: "Test Co", adminName: "Ada Admin", adminEmail: "Ada@Test.example", password: "Str0ng-Password-1" };
  it("is needed on an empty system", async () => {
    expect(await needsSetup(db)).toBe(true);
  });
  it("refuses a wrong setup token, weak passwords and bad input, creating nothing", async () => {
    await expect(firstSetup(db, { ...input, setupToken: "nope", expectedToken: "right" })).rejects.toThrow(/token/);
    await expect(firstSetup(db, { ...input, password: "short1A" })).rejects.toThrow(/12 characters/);
    await expect(firstSetup(db, { ...input, password: "alllowercase1234" })).rejects.toThrow(/upper case/);
    await expect(firstSetup(db, { ...input, adminEmail: "not-an-email" })).rejects.toThrow(/email/);
    expect(await db.organization.count()).toBe(0);
  });
  it("two setups at the same moment create exactly one installation", async () => {
    const results = await Promise.allSettled([firstSetup(db, input), firstSetup(db, { ...input, companyName: "Other Co", adminEmail: "other@test.example" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason)[0]).toBeInstanceOf(SetupError);
    expect(await db.organization.count()).toBe(1);
    expect(await db.user.count()).toBe(1);
  });
  it("creates the baseline: roles, permissions, chart of accounts, stages, leave types and a Super Admin who can sign in", async () => {
    org = (await db.organization.findFirstOrThrow()).id;
    const u = await db.user.findFirstOrThrow({ include: { roles: { include: { role: { include: { permissions: true } } } } } });
    admin = u.id;
    adminEmail = u.email!;
    expect(["ada@test.example", "other@test.example"]).toContain(u.email); // whichever of the two simultaneous setups won
    expect(await bcrypt.compare(input.password, u.passwordHash)).toBe(true);
    expect(u.roles[0].role.key).toBe("SUPER_ADMIN");
    expect(u.roles[0].role.permissions.length).toBeGreaterThan(50);
    expect(await db.account.count({ where: { organizationId: org, systemKey: { not: null } } })).toBeGreaterThanOrEqual(15);
    expect(await db.pipelineStage.count({ where: { organizationId: org, isWon: true } })).toBe(1);
    expect(await db.leaveType.count({ where: { organizationId: org } })).toBe(4);
    expect(await db.auditLog.count({ where: { action: "system.first_setup" } })).toBe(1);
  });
  it("is closed forever once any user exists", async () => {
    expect(await needsSetup(db)).toBe(false);
    await expect(firstSetup(db, { ...input, adminEmail: "third@test.example" })).rejects.toThrow(/already set up/);
    // Without a token setup cannot add a second administrator, and a correct token does not reopen it either
    await expect(firstSetup(db, { ...input, adminEmail: "fourth@test.example", setupToken: "right", expectedToken: "right" })).rejects.toThrow(/already set up/);
    expect(await db.user.count()).toBe(1);
  });
});

describe("two-step verification", () => {
  let userId: string;
  let secret: string;
  beforeAll(async () => {
    userId = (await createUser(db, { organizationId: org, name: "Mia", email: "mia@test.example", roleKeys: ["SALES_AGENT"], actor: superActor(admin) })).id;
  });
  it("stays off until a real code from the app is confirmed, and the secret is stored encrypted", async () => {
    const { secret: s, uri } = await beginMfaSetup(db, userId, APP_SECRET);
    secret = s;
    expect(uri).toContain(`secret=${s}`);
    const row = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.totpEnabled).toBe(false);
    expect(row.totpSecretEnc).not.toContain(s);
    expect(decryptSecret(row.totpSecretEnc!, APP_SECRET)).toBe(s);
    await expect(confirmMfaSetup(db, userId, "000000", APP_SECRET)).rejects.toThrow(/not correct/);
  });
  let codes: string[];
  it("turns on with a valid code and returns eight recovery codes, stored only as hashes", async () => {
    codes = await confirmMfaSetup(db, userId, totp(secret), APP_SECRET);
    expect(codes).toHaveLength(8);
    const row = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.totpEnabled).toBe(true);
    expect(JSON.stringify(row.recoveryCodes)).not.toContain(codes[0]);
  });
  it("a code cannot be used twice, even by two simultaneous attempts", async () => {
    const fresh = () => db.user.findUniqueOrThrow({ where: { id: userId } });
    // Move on to the next 30-second window so the enrolment code is no longer the latest
    const next = totp(secret, Date.now() + 30_000);
    const u = await fresh();
    const results = await Promise.all([checkSecondFactor(db, u, next, APP_SECRET), checkSecondFactor(db, u, next, APP_SECRET)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await checkSecondFactor(db, await fresh(), next, APP_SECRET)).ok).toBe(false); // replay
  });
  it("wrong codes and malformed input are rejected", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect((await checkSecondFactor(db, u, "12", APP_SECRET)).ok).toBe(false);
    expect((await checkSecondFactor(db, u, "zzzz-zzzz-zzzz", APP_SECRET)).ok).toBe(false);
    expect((await checkSecondFactor(db, u, totp(secret, Date.now() - 600_000), APP_SECRET)).ok).toBe(false);
    expect((await checkSecondFactor(db, u, totp(secret, Date.now() + 90_000), "a-different-app-secret-entirely-xx")).ok).toBe(false);
  });
  it("each recovery code works exactly once", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const first = await checkSecondFactor(db, u, codes[0].toUpperCase(), APP_SECRET);
    expect(first).toEqual({ ok: true, usedRecoveryCode: true });
    expect((await checkSecondFactor(db, u, codes[0], APP_SECRET)).ok).toBe(false);
    const both = await Promise.all([checkSecondFactor(db, u, codes[1], APP_SECRET), checkSecondFactor(db, u, codes[1], APP_SECRET)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(((await db.user.findUniqueOrThrow({ where: { id: userId } })).recoveryCodes as string[]).length).toBe(6);
  });
  it("regenerating or turning off needs the password", async () => {
    const pw = "mia-initial-password";
    await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(pw, 10) } });
    await expect(regenerateRecoveryCodes(db, userId, "wrong")).rejects.toThrow(/password/);
    expect((await regenerateRecoveryCodes(db, userId, pw)).length).toBe(8);
    await expect(disableMfa(db, userId, "wrong")).rejects.toThrow(/password/);
    await disableMfa(db, userId, pw);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).totpEnabled).toBe(false);
  });
  it("an administrator can reset it, and that signs the user out; resetting a Super Admin needs a Super Admin", async () => {
    const s = (await beginMfaSetup(db, userId, APP_SECRET)).secret;
    await confirmMfaSetup(db, userId, totp(s), APP_SECRET);
    await db.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000) } });
    const limited: Actor = { id: "x", isSuperAdmin: false, permissions: new Set(["users.manage"]) };
    await adminResetMfa(db, { organizationId: org, userId, actor: limited });
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).totpEnabled).toBe(false);
    expect(await db.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    await expect(adminResetMfa(db, { organizationId: org, userId: admin, actor: limited })).rejects.toThrow(/Super Admin/);
  });
});

describe("password reset links", () => {
  let userId: string;
  beforeAll(async () => {
    userId = (await createUser(db, { organizationId: org, name: "Rae", email: "rae@test.example", roleKeys: ["ACCOUNTANT"], actor: superActor(admin) })).id;
  });
  it("sets a new password once, signs out every session, and kills any other outstanding link", async () => {
    await db.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000) } });
    const t1 = await createResetLink(db, { organizationId: org, userId, createdById: admin });
    const t2 = await createResetLink(db, { organizationId: org, userId, createdById: admin });
    expect(await resetInfo(db, t1)).toEqual({ email: "rae@test.example", who: "rae@test.example" });
    expect(await resetInfo(db, "bogus")).toBeNull();
    await expect(consumeReset(db, { token: t1, password: "short" })).rejects.toThrow(/10 characters/);
    const results = await Promise.allSettled([1, 2].map(() => consumeReset(db, { token: t1, password: "a-brand-new-password" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare("a-brand-new-password", u.passwordHash)).toBe(true);
    expect(u.mustChangePassword).toBe(false);
    expect(await db.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect(await resetInfo(db, t2)).toBeNull(); // the second link died with the first
  });
  it("expired links are refused", async () => {
    const t = await createResetLink(db, { organizationId: org, userId, createdById: admin });
    await db.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(consumeReset(db, { token: t, password: "another-new-password" })).rejects.toThrow(/expired|used/);
  });
  it("a limited administrator cannot reset a Super Admin's password", async () => {
    const limited: Actor = { id: "x", isSuperAdmin: false, permissions: new Set(["users.manage"]) };
    await expect(createResetLink(db, { organizationId: org, userId: admin, createdById: "x", actor: limited })).rejects.toThrow(/Super Admin/);
  });
});

describe("user administration", () => {
  const limited: Actor = { id: "limited", isSuperAdmin: false, permissions: new Set(["users.manage", "dashboard.view"]) };
  it("creates staff only with valid staff roles, and only a Super Admin can create a Super Admin", async () => {
    await expect(createUser(db, { organizationId: org, name: "X", email: "bad", roleKeys: ["INTERN"], actor: limited })).rejects.toThrow(/Enter a name|valid email/);
    await expect(createUser(db, { organizationId: org, name: "Xavier", email: "x@test.example", roleKeys: [], actor: limited })).rejects.toThrow(/valid role/);
    await expect(createUser(db, { organizationId: org, name: "Xavier", email: "x@test.example", roleKeys: ["CLIENT"], actor: limited })).rejects.toThrow(/invited/);
    await expect(createUser(db, { organizationId: org, name: "Xavier", email: "x@test.example", roleKeys: ["SUPER_ADMIN"], actor: limited })).rejects.toThrow(/Only a Super Admin/);
    await expect(createUser(db, { organizationId: org, name: "Ada again", email: adminEmail, roleKeys: ["INTERN"], actor: limited })).rejects.toThrow(/already exists/);
    const u = await createUser(db, { organizationId: org, name: "Ian", email: "ian@test.example", roleKeys: ["INTERN"], actor: limited });
    expect(u.mustChangePassword).toBe(true);
  });
  it("only a Super Admin changes the Super Admin role, and role changes sign the person out", async () => {
    const ian = await db.user.findFirstOrThrow({ where: { email: "ian@test.example" } });
    await db.session.create({ data: { userId: ian.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await expect(setUserRoles(db, { organizationId: org, userId: ian.id, roleKeys: ["SUPER_ADMIN"], actor: limited })).rejects.toThrow(/Only a Super Admin/);
    await setUserRoles(db, { organizationId: org, userId: ian.id, roleKeys: ["SALES_AGENT", "INTERN"], actor: limited });
    expect(await db.session.count({ where: { userId: ian.id, revokedAt: null } })).toBe(0);
    expect(await db.userRole.count({ where: { userId: ian.id } })).toBe(2);
  });
  it("the system always keeps one active Super Admin, even when two admins demote each other at once", async () => {
    await expect(setUserRoles(db, { organizationId: org, userId: admin, roleKeys: ["INTERN"], actor: superActor(admin) })).rejects.toThrow(/at least one active Super Admin/);
    await expect(setUserActive(db, { organizationId: org, userId: admin, active: false, actor: superActor("someone-else") })).rejects.toThrow(/at least one active Super Admin/);
    await expect(setUserActive(db, { organizationId: org, userId: admin, active: false, actor: superActor(admin) })).rejects.toThrow(/own account/);
    const second = await createUser(db, { organizationId: org, name: "Bo", email: "bo@test.example", roleKeys: ["SUPER_ADMIN"], actor: superActor(admin) });
    const results = await Promise.allSettled([
      setUserRoles(db, { organizationId: org, userId: admin, roleKeys: ["INTERN"], actor: superActor(second.id) }),
      setUserRoles(db, { organizationId: org, userId: second.id, roleKeys: ["INTERN"], actor: superActor(admin) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const supers = await db.user.count({ where: { roles: { some: { role: { key: "SUPER_ADMIN" } } }, active: true } });
    expect(supers).toBe(1);
    // restore a second Super Admin for the remaining tests
    const demoted = (await db.user.findFirstOrThrow({ where: { id: { in: [admin, second.id] }, roles: { none: { role: { key: "SUPER_ADMIN" } } } } })).id;
    await setUserRoles(db, { organizationId: org, userId: demoted, roleKeys: ["SUPER_ADMIN"], actor: superActor("any") });
    const keep = await db.user.findFirstOrThrow({ where: { id: { in: [admin, second.id] }, roles: { some: { role: { key: "SUPER_ADMIN" } } }, NOT: { id: demoted } } });
    admin = keep.id;
  });
  it("deactivating signs the person out and blocks sign-in", async () => {
    const ian = await db.user.findFirstOrThrow({ where: { email: "ian@test.example" } });
    await db.session.create({ data: { userId: ian.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await setUserActive(db, { organizationId: org, userId: ian.id, active: false, actor: limited });
    expect((await db.user.findUniqueOrThrow({ where: { id: ian.id } })).active).toBe(false);
    expect(await db.session.count({ where: { userId: ian.id, revokedAt: null } })).toBe(0);
  });
});

describe("roles", () => {
  const limited: Actor = { id: "limited", isSuperAdmin: false, permissions: new Set(["roles.manage", "leads.view", "crm.view", "catalog.view"]) };
  it("a limited administrator can only grant permissions they hold", async () => {
    await expect(createRole(db, { organizationId: org, name: "Sneaky", permissionKeys: ["payroll.view"], actor: limited })).rejects.toThrow(/do not hold/);
    await expect(createRole(db, { organizationId: org, name: "Bad", permissionKeys: ["made.up"], actor: limited })).rejects.toThrow(/Unknown permission/);
    const r = await createRole(db, { organizationId: org, name: "Sales Support", permissionKeys: ["crm.view", "catalog.view"], actor: limited });
    expect(r.key).toBe("CUSTOM_SALES_SUPPORT");
    expect(r.isSystem).toBe(false);
    await expect(createRole(db, { organizationId: org, name: "sales support", permissionKeys: [], actor: limited })).rejects.toThrow(/already exists/);
  });
  it("editing a role changes what its holders can do, and signs them out", async () => {
    const role = await db.role.findFirstOrThrow({ where: { key: "CUSTOM_SALES_SUPPORT" } });
    const holder = await createUser(db, { organizationId: org, name: "Sue", email: "sue@test.example", roleKeys: ["CUSTOM_SALES_SUPPORT"], actor: superActor(admin) });
    await db.session.create({ data: { userId: holder.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await expect(setRolePermissions(db, { organizationId: org, roleId: role.id, permissionKeys: ["crm.view", "finance.post"], actor: limited })).rejects.toThrow(/do not hold/);
    const res = await setRolePermissions(db, { organizationId: org, roleId: role.id, permissionKeys: ["crm.view"], actor: limited });
    expect(res.affectedUsers).toBe(1);
    expect(res.before).toEqual(["catalog.view", "crm.view"]);
    expect(await db.session.count({ where: { userId: holder.id, revokedAt: null } })).toBe(0);
  });
  it("a limited administrator cannot strip permissions they do not hold from a role", async () => {
    const accountant = await db.role.findFirstOrThrow({ where: { key: "ACCOUNTANT" } });
    await expect(setRolePermissions(db, { organizationId: org, roleId: accountant.id, permissionKeys: ["crm.view"], actor: limited })).rejects.toThrow(/cannot remove/);
  });
  it("Super Admin cannot be edited, external roles stay empty, built-in roles cannot be deleted, and roles in use cannot be deleted", async () => {
    const sa = await db.role.findFirstOrThrow({ where: { key: "SUPER_ADMIN" } });
    await expect(setRolePermissions(db, { organizationId: org, roleId: sa.id, permissionKeys: [], actor: superActor(admin) })).rejects.toThrow(/cannot be edited/);
    const client = await db.role.findFirstOrThrow({ where: { key: "CLIENT" } });
    await expect(setRolePermissions(db, { organizationId: org, roleId: client.id, permissionKeys: ["crm.view"], actor: superActor(admin) })).rejects.toThrow(/portals/);
    await expect(deleteRole(db, { organizationId: org, roleId: client.id })).rejects.toThrow(/Built-in/);
    const custom = await db.role.findFirstOrThrow({ where: { key: "CUSTOM_SALES_SUPPORT" } });
    await expect(deleteRole(db, { organizationId: org, roleId: custom.id })).rejects.toThrow(/still hold/);
    const spare = await createRole(db, { organizationId: org, name: "Spare", permissionKeys: [], actor: superActor(admin) });
    await deleteRole(db, { organizationId: org, roleId: spare.id });
    expect(await db.role.count({ where: { key: "CUSTOM_SPARE" } })).toBe(0);
    expect(AccountError).toBeDefined();
  });
});
