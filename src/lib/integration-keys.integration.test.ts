import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { clearKey, getKey, isConfigured, keyStatuses, setKey } from "./integration-keys";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const SECRET = "s".repeat(48);
const KEY = "AIzaSyExampleKey1234567890";
let org: string, other: string, user: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "IntegrationKey","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Keys Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  user = (await db.user.create({ data: { organizationId: org, email: "sa@k.test", name: "SA", passwordHash: "x" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("integration key store", () => {
  it("stores only ciphertext, and reads it back for server use", async () => {
    await setKey(db, { organizationId: org, provider: "GOOGLE_PLACES", value: KEY, userId: user, secret: SECRET });
    const row = await db.integrationKey.findFirstOrThrow({ where: { organizationId: org } });
    expect(row.valueEnc).not.toContain("AIzaSy");
    expect(row.hint).toBe("7890");
    expect(row.updatedById).toBe(user);
    expect(await getKey(db, org, "GOOGLE_PLACES", {}, SECRET)).toBe(KEY);
  });
  it("status never carries the key, only where it comes from and the last 4 characters", async () => {
    const s = await keyStatuses(db, org, {}, SECRET);
    expect(JSON.stringify(s)).not.toContain("AIzaSy");
    expect(s.find((x) => x.provider === "GOOGLE_PLACES")).toMatchObject({ source: "app", hint: "7890", unreadable: false });
    expect(s.find((x) => x.provider === "SOCIALAPIS")).toMatchObject({ source: null });
  });
  it("is private to the organization", async () => {
    expect(await getKey(db, other, "GOOGLE_PLACES", {}, SECRET)).toBeUndefined();
  });
  it("replaces a key, and the saved key wins over the server environment", async () => {
    await setKey(db, { organizationId: org, provider: "GOOGLE_PLACES", value: "AIzaSyReplacementKey0000999", userId: user, secret: SECRET });
    expect(await getKey(db, org, "GOOGLE_PLACES", { GOOGLE_PLACES_API_KEY: "env-key-env-key-env-key" }, SECRET)).toBe("AIzaSyReplacementKey0000999");
    expect(await db.integrationKey.count({ where: { organizationId: org } })).toBe(1);
  });
  it("falls back to the server environment, and is not configured with neither", async () => {
    expect(await getKey(db, org, "SOCIALAPIS", { SOCIALAPIS_API_KEY: " from-env-from-env-1234 " }, SECRET)).toBe("from-env-from-env-1234");
    expect((await keyStatuses(db, org, { SOCIALAPIS_API_KEY: "from-env-from-env-1234" }, SECRET)).find((x) => x.provider === "SOCIALAPIS")).toMatchObject({ source: "server" });
    expect(await getKey(db, org, "GOOGLE_PAGESPEED", {}, SECRET)).toBeUndefined();
  });
  it("treats a key sealed under another secret as unreadable, falls back, and says so", async () => {
    expect(await getKey(db, org, "GOOGLE_PLACES", {}, "z".repeat(48))).toBeUndefined();
    expect(await getKey(db, org, "GOOGLE_PLACES", { GOOGLE_PLACES_API_KEY: "env-key-env-key-env-key" }, "z".repeat(48))).toBe("env-key-env-key-env-key");
    expect((await keyStatuses(db, org, {}, "z".repeat(48))).find((x) => x.provider === "GOOGLE_PLACES")).toMatchObject({ source: null, unreadable: true });
  });
  it("clears a key and then reports not configured", async () => {
    expect(await clearKey(db, { organizationId: org, provider: "GOOGLE_PLACES" })).toBe(1);
    expect(await clearKey(db, { organizationId: org, provider: "GOOGLE_PLACES" })).toBe(0);
    expect(await getKey(db, org, "GOOGLE_PLACES", {}, SECRET)).toBeUndefined();
    expect(typeof isConfigured).toBe("function");
  });
});
