import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { syncPermissionsAndRoles } from "./bootstrap";
import { needsMfaSetup, secretStrength } from "./mfa-policy";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

describe("two-step requirement rule", () => {
  it("only staff in a protected role without it enabled are sent to set it up", () => {
    expect(needsMfaSetup({ userType: "EMPLOYEE", mfaRequired: true, totpEnabled: false })).toBe(true);
    expect(needsMfaSetup({ userType: "EMPLOYEE", mfaRequired: true, totpEnabled: true })).toBe(false);
    expect(needsMfaSetup({ userType: "EMPLOYEE", mfaRequired: false, totpEnabled: false })).toBe(false);
    expect(needsMfaSetup({ userType: "CLIENT", mfaRequired: true, totpEnabled: false })).toBe(false);
  });

  it("judges the session secret", () => {
    expect(secretStrength(undefined).level).toBe("fail");
    expect(secretStrength("short").level).toBe("fail");
    expect(secretStrength("change-me-change-me-change-me-change-me").level).toBe("warn");
    expect(secretStrength("q8Zr3Lw0Vx9Tn5Kb2Hs7Jd1Fg6Ym4Pc8Ae").level).toBe("ok");
  });
});

describe("role defaults", () => {
  let a: string, b: string;
  beforeAll(async () => {
    await db.$executeRawUnsafe('TRUNCATE "UserRole","RolePermission","Role","Organization" CASCADE');
    a = (await db.organization.create({ data: { name: "New install" } })).id;
    b = (await db.organization.create({ data: { name: "Existing" } })).id;
  });
  afterAll(async () => { await db.$disconnect(); });

  it("a new installation requires it for money, people and admin roles only", async () => {
    await syncPermissionsAndRoles(db, a, { overwrite: true, requireMfaForSensitive: true });
    const roles = await db.role.findMany({ where: { organizationId: a, requireMfa: true } });
    expect(roles.map((r) => r.key).sort()).toEqual(["ACCOUNTANT", "CEO", "FINANCE_MANAGER", "HR_COORDINATOR", "HR_MANAGER", "SUPER_ADMIN"]);
  });

  it("an existing installation is not locked out by a sync, and a re-sync never switches it off", async () => {
    await syncPermissionsAndRoles(db, b, { overwrite: true });
    expect(await db.role.count({ where: { organizationId: b, requireMfa: true } })).toBe(0);
    await db.role.updateMany({ where: { organizationId: a, key: "CEO" }, data: { requireMfa: false } });
    await syncPermissionsAndRoles(db, a, { overwrite: true, requireMfaForSensitive: true });
    expect((await db.role.findFirstOrThrow({ where: { organizationId: a, key: "CEO" } })).requireMfa).toBe(false); // an administrator's choice is kept
  });
});

describe("backup check script", () => {
  const script = path.resolve("scripts/check-backup.mjs");
  const run = (dir: string, ...extra: string[]) => spawnSync("node", [script, dir, ...extra], { encoding: "utf8" });
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));

  it("passes a fresh dump and fails when missing, stale, empty or not a dump", () => {
    const good = tmp();
    fs.writeFileSync(path.join(good, "db.dump"), "PGDMP" + "x".repeat(4000));
    expect(run(good).status).toBe(0);

    expect(run(path.join(good, "nowhere")).status).toBe(1);

    const stale = tmp();
    const f = path.join(stale, "old.dump");
    fs.writeFileSync(f, "PGDMP" + "x".repeat(4000));
    const old = new Date(Date.now() - 40 * 3_600_000);
    fs.utimesSync(f, old, old);
    expect(run(stale).status).toBe(1);
    expect(run(stale, "--max-hours", "72").status).toBe(0);

    const empty = tmp();
    fs.writeFileSync(path.join(empty, "e.dump"), "");
    expect(run(empty).status).toBe(1);

    const text = tmp();
    fs.writeFileSync(path.join(text, "t.dump"), "hello world ".repeat(300));
    expect(run(text).status).toBe(1);
    expect(execFileSync("node", ["-e", "0"]).length).toBe(0);
  });
});
