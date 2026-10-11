import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadLayout, resetLayout, resolveLayout, saveLayout } from "./dashboard-layout";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
beforeAll(async () => { await db.$executeRawUnsafe('TRUNCATE "UserPreference"'); });
afterAll(async () => { await db.$disconnect(); });

describe("dashboard layout", () => {
  it("defaults to the available order with nothing hidden", () => {
    expect(resolveLayout(undefined, ["a", "b", "c"])).toEqual({ order: ["a", "b", "c"], hidden: [] });
    expect(resolveLayout("junk", ["a"])).toEqual({ order: ["a"], hidden: [] });
  });

  it("drops widgets the person may not see, repeats and wrong types, and appends new widgets", () => {
    const l = resolveLayout({ order: ["c", "money", "c", 7, "a"], hidden: ["money", "b", "b"] }, ["a", "b", "c", "d"]);
    expect(l).toEqual({ order: ["c", "a", "b", "d"], hidden: ["b"] });
  });

  it("saves per user, survives reload, and cannot store widgets outside the allowed list", async () => {
    await saveLayout(db, "u1", { order: ["b", "a", "secret"], hidden: ["a", "secret"] }, ["a", "b"]);
    await saveLayout(db, "u2", { order: ["a", "b"], hidden: [] }, ["a", "b"]);
    expect(await loadLayout(db, "u1", ["a", "b"])).toEqual({ order: ["b", "a"], hidden: ["a"] });
    expect(await loadLayout(db, "u2", ["a", "b"])).toEqual({ order: ["a", "b"], hidden: [] });
    // If the person later loses access to a widget it is not shown, and the saved choice for the rest is kept
    expect(await loadLayout(db, "u1", ["b"])).toEqual({ order: ["b"], hidden: [] });
    await saveLayout(db, "u1", { order: ["a", "b"], hidden: [] }, ["a", "b"]);
    expect((await db.userPreference.findMany({ where: { userId: "u1" } })).length).toBe(1);
    await resetLayout(db, "u1");
    expect(await loadLayout(db, "u1", ["a", "b"])).toEqual({ order: ["a", "b"], hidden: [] });
  });
});
