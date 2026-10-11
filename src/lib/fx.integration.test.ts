import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { FxError, addRate, consolidateRows, consolidatedBalanceSheet, getBaseCurrency, rateOn, ratesOn, setBaseCurrency } from "./fx";
import { dec } from "./ledger-math";
import type { BalanceRow } from "./statements";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string;
let other: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ExchangeRate","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Fx Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const row = (code: string, type: string, currency: string, debit: string, credit: string): BalanceRow => ({ code, name: code, type, currency, debit, credit });

describe("exchange rates", () => {
  it("defaults the base currency to USD and treats it as rate 1", async () => {
    expect(await getBaseCurrency(db, org)).toBe("USD");
    expect((await rateOn(db, org, "USD", "2026-01-01"))!.toString()).toBe("1");
  });

  it("returns null when no rate exists on or before the date", async () => {
    expect(await rateOn(db, org, "PKR", "2026-01-01")).toBeNull();
  });

  it("uses the rate in force on the date and keeps history", async () => {
    await addRate(db, { organizationId: org, currency: "PKR", rate: "0.0035", effectiveDate: "2026-01-01", actorId: "u" });
    await addRate(db, { organizationId: org, currency: "PKR", rate: "0.0036", effectiveDate: "2026-03-01", actorId: "u" });
    expect((await rateOn(db, org, "PKR", "2026-02-15"))!.toString()).toBe("0.0035");
    expect((await rateOn(db, org, "PKR", "2026-03-01"))!.toString()).toBe("0.0036");
    expect(await rateOn(db, org, "PKR", "2025-12-31")).toBeNull();
    expect(await db.exchangeRate.count({ where: { organizationId: org, currency: "PKR" } })).toBe(2);
  });

  it("a correction for the same date is a new row and the latest entry wins", async () => {
    await addRate(db, { organizationId: org, currency: "AED", rate: "0.27", effectiveDate: "2026-02-01", actorId: "u" });
    await new Promise((r) => setTimeout(r, 15));
    await addRate(db, { organizationId: org, currency: "AED", rate: "0.2723", effectiveDate: "2026-02-01", actorId: "u" });
    expect((await rateOn(db, org, "AED", "2026-02-01"))!.toString()).toBe("0.2723");
    expect(await db.exchangeRate.count({ where: { organizationId: org, currency: "AED" } })).toBe(2);
  });

  it("rejects bad input", async () => {
    const bad = (p: Partial<{ currency: string; rate: string; effectiveDate: string }>) =>
      addRate(db, { organizationId: org, currency: "GBP", rate: "1.27", effectiveDate: "2026-01-01", actorId: "u", ...p });
    await expect(bad({ rate: "0" })).rejects.toThrow(FxError);
    await expect(bad({ rate: "-1" })).rejects.toThrow(FxError);
    await expect(bad({ rate: "abc" })).rejects.toThrow(FxError);
    await expect(bad({ rate: "1.123456789" })).rejects.toThrow(FxError);
    await expect(bad({ currency: "XYZ" })).rejects.toThrow(FxError);
    await expect(bad({ currency: "USD" })).rejects.toThrow(/base currency/);
    await expect(bad({ effectiveDate: "2026-13-45" })).rejects.toThrow(FxError);
    await expect(bad({ effectiveDate: "yesterday" })).rejects.toThrow(FxError);
  });

  it("rates belong to one organization", async () => {
    expect(await rateOn(db, other, "PKR", "2026-06-01")).toBeNull();
  });

  it("the base currency cannot change once rates exist, but can before", async () => {
    await expect(setBaseCurrency(db, { organizationId: org, currency: "GBP" })).rejects.toThrow(/cannot change/);
    expect(await setBaseCurrency(db, { organizationId: other, currency: "PKR" })).toBe("PKR");
    expect((await rateOn(db, other, "PKR", "2026-01-01"))!.toString()).toBe("1");
    await expect(setBaseCurrency(db, { organizationId: other, currency: "EUR" })).rejects.toThrow(FxError);
  });

  it("batch lookup returns null for currencies without a rate", async () => {
    const m = await ratesOn(db, org, ["USD", "PKR", "GBP"], "2026-03-02");
    expect(m.get("USD")!.toString()).toBe("1");
    expect(m.get("PKR")!.toString()).toBe("0.0036");
    expect(m.get("GBP")).toBeNull();
  });
});

describe("consolidation", () => {
  it("converts and merges the same account across currencies", () => {
    const rows = [
      row("4000", "REVENUE", "USD", "0", "1000.00"),
      row("4000", "REVENUE", "PKR", "0", "280000.00"),
    ];
    const { rows: out, missing } = consolidateRows(rows, "USD", new Map([["PKR", dec("0.0036")]]));
    expect(missing).toEqual([]);
    expect(out).toHaveLength(1);
    expect(dec(out[0].credit).eq("2008")).toBe(true); // 1000 + 280000 * 0.0036
    expect(out[0].currency).toBe("USD");
  });

  it("reports currencies without a rate as missing and leaves them out, never as 1:1", () => {
    const rows = [row("4000", "REVENUE", "USD", "0", "100.00"), row("4000", "REVENUE", "AED", "0", "500.00")];
    const { rows: out, missing } = consolidateRows(rows, "USD", new Map([["AED", null]]));
    expect(missing).toEqual(["AED"]);
    expect(dec(out[0].credit).eq("100")).toBe(true);
  });

  it("a balanced multi-currency ledger stays balanced after conversion, within rounding", () => {
    const rows = [
      row("1100", "ASSET", "USD", "5000.00", "0"), row("3000", "EQUITY", "USD", "0", "5000.00"),
      row("1100", "ASSET", "PKR", "1000000.00", "0"), row("3000", "EQUITY", "PKR", "0", "1000000.00"),
      row("1200", "ASSET", "AED", "333.33", "0"), row("2000", "LIABILITY", "AED", "0", "333.33"),
    ];
    const { rows: out } = consolidateRows(rows, "USD", new Map([["PKR", dec("0.00357")], ["AED", dec("0.27231")]]));
    const b = consolidatedBalanceSheet(out);
    expect(b.balanced).toBe(true);
    expect(b.rounding.abs().lt(0.05)).toBe(true);
    expect(b.totals.assets.toString()).toBe("8660.77"); // 5000 + 3570 + 90.77 (333.33 * 0.27231 = 90.7694...)
  });

  it("flags a real imbalance rather than hiding it in rounding", () => {
    const b = consolidatedBalanceSheet([row("1100", "ASSET", "USD", "100.00", "0"), row("3000", "EQUITY", "USD", "0", "90.00")]);
    expect(b.balanced).toBe(false);
  });
});
