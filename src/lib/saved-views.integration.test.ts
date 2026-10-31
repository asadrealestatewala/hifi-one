import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ViewError, cleanQuery, deleteView, loadViews, saveView } from "./saved-views";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
beforeAll(async () => { await db.$executeRawUnsafe('TRUNCATE "UserPreference" CASCADE'); });
afterAll(async () => { await db.$disconnect(); });

describe("saved views", () => {
  it("keeps only the list's own filters and drops paging and anything unknown", () => {
    expect(cleanQuery("clients", "?q=acme&show=all&page=3&new=1&sort=name&dir=desc&evil=1")).toBe("q=acme&show=all&sort=name&dir=desc");
    expect(cleanQuery("invoices", "status=OVERDUE&show=all")).toBe("status=OVERDUE");
    expect(() => cleanQuery("payroll", "q=x")).toThrow(ViewError);
  });

  it("saves, replaces by name, lists and removes views for one person only", async () => {
    await expect(saveView(db, { userId: "u1", list: "invoices", name: "x", query: "status=OVERDUE" })).rejects.toThrow(/name/);
    await expect(saveView(db, { userId: "u1", list: "invoices", name: "Nothing", query: "page=2" })).rejects.toThrow(/Apply a filter/);
    await saveView(db, { userId: "u1", list: "invoices", name: "Overdue", query: "status=OVERDUE" });
    await saveView(db, { userId: "u1", list: "invoices", name: "overdue", query: "status=OVERDUE&sort=due&dir=asc" });
    expect(await loadViews(db, "u1", "invoices")).toEqual([{ name: "overdue", query: "status=OVERDUE&sort=due&dir=asc" }]);
    expect(await loadViews(db, "u2", "invoices")).toEqual([]);
    expect(await loadViews(db, "u1", "clients")).toEqual([]);
    await deleteView(db, { userId: "u1", list: "invoices", name: "overdue" });
    expect(await loadViews(db, "u1", "invoices")).toEqual([]);
  });

  it("allows ten views per list", async () => {
    for (let i = 0; i < 10; i++) await saveView(db, { userId: "u3", list: "clients", name: `View ${i}`, query: `q=a${i}` });
    await expect(saveView(db, { userId: "u3", list: "clients", name: "One more", query: "q=z" })).rejects.toThrow(/10 views/);
  });
});
