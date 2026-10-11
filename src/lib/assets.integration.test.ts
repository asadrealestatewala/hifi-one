// Asset and investment integration tests against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  AssetError, assetValue, assignAsset, createInvestment, disposeAsset, investmentPosition, recordInvestmentTransaction, registerAsset, runDepreciation,
} from "./assets";
import { trialBalance } from "./accounting";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let bank: string;
let bankPkr: string;
let user: string;
const actor = "actor-1";

const balanced = async () => {
  const tb = await trialBalance(db, org);
  return { dr: tb.reduce((s, r) => s + Number(r.debit), 0), cr: tb.reduce((s, r) => s + Number(r.credit), 0), tb };
};
const row = async (code: string) => (await balanced()).tb.find((r) => r.code === code && r.currency === "USD");

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "InvestmentTransaction","Investment","DepreciationEntry","AssetAssignment","Asset","JournalLine","JournalEntry","BankAccount","Account","NumberSequence","UserRole","User","Role","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "Asset Test Org" } })).id;
  user = (await db.user.create({ data: { organizationId: org, email: "u@a.example", name: "U", passwordHash: "x" } })).id;
  const mk = (code: string, name: string, type: string, systemKey: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("1500", "Fixed assets", "ASSET", "FIXED_ASSETS");
  await mk("1590", "Accum depreciation", "ASSET", "ACCUM_DEPRECIATION");
  await mk("6040", "Depreciation", "OPEX", "DEPRECIATION_EXPENSE");
  await mk("7100", "Gain", "OTHER_INCOME", "GAIN_DISPOSAL");
  await mk("8100", "Loss", "OTHER_EXPENSE", "LOSS_DISPOSAL");
  await mk("2000", "AP", "LIABILITY", "ACCOUNTS_PAYABLE");
  await mk("1510", "Investments", "ASSET", "INVESTMENTS");
  await mk("1530", "Inv receivable", "ASSET", "INVESTMENT_RECEIVABLE");
  await mk("7000", "Investment income", "OTHER_INCOME", "INVESTMENT_INCOME");
  const cash = await db.account.create({ data: { organizationId: org, code: "1100", name: "Bank USD", type: "ASSET" } });
  const cashPkr = await db.account.create({ data: { organizationId: org, code: "1101", name: "Bank PKR", type: "ASSET" } });
  const mkBank = (n: string, cur: string, led: string) =>
    db.bankAccount.create({ data: { organizationId: org, internalName: n, bankName: "B", accountHolder: "H", accountNumber: "1234", currency: cur, ledgerAccountId: led } });
  bank = (await mkBank("USD", "USD", cash.id)).id;
  bankPkr = (await mkBank("PKR", "PKR", cashPkr.id)).id;
});
afterAll(async () => {
  await db.$disconnect();
});

const laptop = (extra: Partial<Parameters<typeof registerAsset>[1]> = {}) =>
  registerAsset(db, {
    organizationId: org, actorId: actor, name: "Laptop", purchaseDate: "2026-10-15", cost: "1200", salvageValue: "0", currency: "USD", usefulLifeMonths: 12,
    payment: { kind: "BANK", bankAccountId: bank }, ...extra,
  });

describe("asset purchase", () => {
  it("capitalises the purchase (not an expense) and validates input", async () => {
    const a = await laptop();
    expect(a.number).toBe("FA-0001");
    expect((await row("1500"))!.debit).toBe("1200.00");
    expect(await row("6040")).toBeUndefined(); // no expense recognised at purchase
    await expect(laptop({ cost: "0" })).rejects.toThrow(/cost/);
    await expect(laptop({ salvageValue: "5000" })).rejects.toThrow(/Salvage/);
    await expect(laptop({ usefulLifeMonths: 0 })).rejects.toThrow(/Useful life/);
    await expect(laptop({ payment: { kind: "BANK", bankAccountId: bankPkr } })).rejects.toThrow(/USD bank/);
    expect((await balanced()).dr).toBe((await balanced()).cr);
  });

  it("an unpaid purchase credits payables instead of cash", async () => {
    await laptop({ name: "Desk", cost: "300", payment: { kind: "PAYABLE" } });
    expect((await row("2000"))!.credit).toBe("300.00");
  });

  it("assignment keeps a history and refuses unknown people", async () => {
    const a = await db.asset.findFirstOrThrow({ where: { name: "Laptop" } });
    await expect(assignAsset(db, { organizationId: org, assetId: a.id, userId: "nobody" })).rejects.toThrow(/Unknown employee/);
    await assignAsset(db, { organizationId: org, assetId: a.id, userId: user });
    await assignAsset(db, { organizationId: org, assetId: a.id, userId: null });
    const h = await db.assetAssignment.findMany({ where: { assetId: a.id } });
    expect(h).toHaveLength(1);
    expect(h[0].returnedAt).not.toBeNull();
  });
});

describe("depreciation", () => {
  it("posts each month once, even when run twice or concurrently", async () => {
    await Promise.all([1, 2].map(() => runDepreciation(db, { organizationId: org, upTo: "2026-12", actorId: actor })));
    const count = await db.depreciationEntry.count();
    expect(count).toBe(6); // 2 assets x 3 months (Oct, Nov, Dec)
    await runDepreciation(db, { organizationId: org, upTo: "2026-12", actorId: actor });
    expect(await db.depreciationEntry.count()).toBe(6);
    const laptopRow = await assetValue(db, (await db.asset.findFirstOrThrow({ where: { name: "Laptop" } })).id);
    expect(laptopRow.accumulated.toString()).toBe("300"); // 1200 / 12 * 3
    expect(laptopRow.netBookValue.toString()).toBe("900");
    expect((await row("1590"))!.credit).toBe("375.00"); // laptop 300 + desk 75
    expect((await balanced()).dr).toBe((await balanced()).cr);
  });

  it("a later run only adds the new months", async () => {
    await runDepreciation(db, { organizationId: org, upTo: "2027-01", actorId: actor });
    expect(await db.depreciationEntry.count()).toBe(8);
  });

  it("the final month absorbs rounding so the asset ends at its salvage value", async () => {
    const a = await laptop({ name: "Printer", cost: "1000", salvageValue: "100", usefulLifeMonths: 7, purchaseDate: "2026-01-10" });
    await runDepreciation(db, { organizationId: org, upTo: "2026-12", actorId: actor });
    const v = await assetValue(db, a.id);
    expect(v.accumulated.toString()).toBe("900");
    expect(v.netBookValue.toString()).toBe("100");
  });
});

describe("disposal", () => {
  it("needs depreciation posted through the disposal month", async () => {
    const a = await db.asset.findFirstOrThrow({ where: { name: "Laptop" } });
    await expect(disposeAsset(db, { organizationId: org, assetId: a.id, date: "2027-06-30", proceeds: "0", actorId: actor })).rejects.toThrow(/Run depreciation/);
  });

  it("records a loss when sold below book value, and posts once even if retried", async () => {
    await runDepreciation(db, { organizationId: org, upTo: "2027-03", actorId: actor });
    const a = await db.asset.findFirstOrThrow({ where: { name: "Laptop" } });
    // 6 months depreciated (Oct to Mar): accumulated 600, NBV 600. Sold for 400: loss 200
    await expect(disposeAsset(db, { organizationId: org, assetId: a.id, date: "2027-03-31", proceeds: "400", actorId: actor })).rejects.toThrow(/bank account/);
    await Promise.all([1, 2].map(() => disposeAsset(db, { organizationId: org, assetId: a.id, date: "2027-03-31", proceeds: "400", bankAccountId: bank, actorId: actor })));
    expect(await db.journalEntry.count({ where: { sourceType: "ASSET_DISPOSAL", sourceId: a.id } })).toBe(1);
    expect((await db.asset.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DISPOSED");
    expect((await row("8100"))!.debit).toBe("200.00");
    expect((await balanced()).dr).toBe((await balanced()).cr);
    await expect(assignAsset(db, { organizationId: org, assetId: a.id, userId: user })).rejects.toThrow(/disposed/);
  });

  it("a disposed asset is no longer depreciated", async () => {
    const before = await db.depreciationEntry.count();
    await runDepreciation(db, { organizationId: org, upTo: "2027-09", actorId: actor });
    const laptopEntries = await db.depreciationEntry.count({ where: { asset: { name: "Laptop" } } });
    expect(laptopEntries).toBe(6);
    expect(await db.depreciationEntry.count()).toBeGreaterThanOrEqual(before);
  });

  it("records a gain when sold above book value", async () => {
    const d = await db.asset.findFirstOrThrow({ where: { name: "Desk" } });
    await runDepreciation(db, { organizationId: org, upTo: "2026-11", actorId: actor }); // already posted; no-op
    // Desk: 300 over 12 months = 25/month; by 2027-09 it has 12 months posted (Oct 26 .. Sep 27) -> accumulated 300, NBV 0
    await disposeAsset(db, { organizationId: org, assetId: d.id, date: "2027-09-30", proceeds: "50", bankAccountId: bank, actorId: actor });
    expect((await row("7100"))!.credit).toBe("50.00");
    expect((await balanced()).dr).toBe((await balanced()).cr);
  });
});

describe("investments", () => {
  let invId: string;
  it("separates capital, recognised income and cash received; cash cannot exceed recognised income", async () => {
    const inv = await createInvestment(db, { organizationId: org, name: "Cafe stake", investee: "Cafe LLC", currency: "USD", investmentDate: "2026-10-01", ownershipPct: "20" });
    invId = inv.id;
    const tx = (kind: "CAPITAL" | "INCOME_RECOGNISED" | "INCOME_RECEIVED", amount: string, requestKey: string) =>
      recordInvestmentTransaction(db, { organizationId: org, investmentId: invId, kind, amount, date: "2026-11-01", bankAccountId: bank, requestKey, actorId: actor });
    await tx("CAPITAL", "5000", "k1");
    await tx("INCOME_RECOGNISED", "400", "k2");
    await expect(tx("INCOME_RECEIVED", "500", "k3")).rejects.toThrow(/outstanding/);
    await tx("INCOME_RECEIVED", "150", "k4");
    const pos = await investmentPosition(db, invId);
    expect(pos.capital.toString()).toBe("5000");
    expect(pos.recognised.toString()).toBe("400");
    expect(pos.received.toString()).toBe("150");
    expect(pos.outstanding.toString()).toBe("250");
    expect((await row("7000"))!.credit).toBe("400.00"); // recognised, regardless of cash
    expect((await row("1530"))!.debit).toBe("400.00");
    expect((await row("1530"))!.credit).toBe("150.00");
  });

  it("retrying the same request key never double-posts", async () => {
    const before = await db.investmentTransaction.count();
    const again = await recordInvestmentTransaction(db, { organizationId: org, investmentId: invId, kind: "INCOME_RECEIVED", amount: "150", date: "2026-11-01", bankAccountId: bank, requestKey: "k4", actorId: actor });
    expect(again.kind).toBe("INCOME_RECEIVED");
    expect(await db.investmentTransaction.count()).toBe(before);
    expect((await balanced()).dr).toBe((await balanced()).cr);
  });

  it("rejects bad input with the right error", async () => {
    await expect(createInvestment(db, { organizationId: org, name: "x", investee: "y", currency: "USD", investmentDate: "2026-10-01" })).rejects.toThrow(AssetError);
  });
});
