// Fixed assets (purchase capitalisation, monthly depreciation, disposal) and investments.
// Everything posts through the shared journal and is idempotent. Free of Next.js imports.
import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { LedgerError, dec, round2, type DraftLine } from "./ledger-math";
import { postJournal } from "./accounting";
import { monthlyAmount, periodsDue, addMonths, startPeriod } from "./asset-rules";

export class AssetError extends Error {}
type Tx = Prisma.TransactionClient;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

async function seq(tx: Tx, organizationId: string, key: string, prefix: string) {
  const s = await tx.numberSequence.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, next: 2 },
    update: { next: { increment: 1 } },
  });
  return `${prefix}-${String(s.next - 1).padStart(4, "0")}`;
}

async function sys(tx: Tx, organizationId: string, systemKey: string) {
  const a = await tx.account.findFirst({ where: { organizationId, systemKey, active: true } });
  if (!a) throw new LedgerError(`Chart of accounts is missing the ${systemKey} account.`);
  return a;
}

async function bankLedger(tx: Tx, organizationId: string, bankAccountId: string, currency: string) {
  const bank = await tx.bankAccount.findFirst({ where: { id: bankAccountId, organizationId, active: true } });
  if (!bank?.ledgerAccountId) throw new AssetError("Choose an active bank account linked to the ledger.");
  if (bank.currency !== currency) throw new AssetError(`Choose a ${currency} bank account.`);
  return bank.ledgerAccountId;
}

// ----- Fixed assets -----

export async function registerAsset(
  db: PrismaClient,
  p: {
    organizationId: string; actorId: string; name: string; category?: string; serialNumber?: string; supplier?: string; purchaseDate: string;
    cost: string; salvageValue?: string; currency: string; usefulLifeMonths: number; location?: string;
    payment: { kind: "BANK"; bankAccountId: string } | { kind: "PAYABLE" };
  },
) {
  if (p.name.trim().length < 2) throw new AssetError("Enter an asset name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.purchaseDate)) throw new AssetError("Enter a valid purchase date.");
  if (!MONEY.test(p.cost) || Number(p.cost) <= 0) throw new AssetError("Enter the purchase cost.");
  const salvage = p.salvageValue || "0";
  if (!MONEY.test(salvage) || Number(salvage) > Number(p.cost)) throw new AssetError("Salvage value cannot exceed the cost.");
  if (!Number.isInteger(p.usefulLifeMonths) || p.usefulLifeMonths < 1 || p.usefulLifeMonths > 600) throw new AssetError("Useful life must be 1 to 600 months.");
  return db.$transaction(async (tx) => {
    const number = await seq(tx, p.organizationId, "ASSET", "FA");
    const fixed = await sys(tx, p.organizationId, "FIXED_ASSETS");
    const credit =
      p.payment.kind === "BANK"
        ? await bankLedger(tx, p.organizationId, p.payment.bankAccountId, p.currency)
        : (await sys(tx, p.organizationId, "ACCOUNTS_PAYABLE")).id;
    const asset = await tx.asset.create({
      data: {
        organizationId: p.organizationId, number, name: p.name.trim(), category: p.category || null, serialNumber: p.serialNumber || null, supplier: p.supplier || null,
        purchaseDate: p.purchaseDate, cost: p.cost, salvageValue: salvage, currency: p.currency, usefulLifeMonths: p.usefulLifeMonths, location: p.location || null,
      },
    });
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(`${p.purchaseDate}T00:00:00Z`), memo: `Asset purchase ${number}: ${asset.name}`, currency: p.currency,
      sourceType: "ASSET_PURCHASE", sourceId: asset.id, idempotencyKey: `asset-purchase:${asset.id}`, postedById: p.actorId,
      lines: [{ accountId: fixed.id, debit: p.cost, memo: number }, { accountId: credit, credit: p.cost, memo: number }],
    });
    return tx.asset.update({ where: { id: asset.id }, data: { purchaseEntryId: entry.id } });
  });
}

export async function assignAsset(db: PrismaClient, p: { organizationId: string; assetId: string; userId: string | null }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Asset" WHERE id = ${p.assetId} FOR UPDATE`;
    const a = await tx.asset.findFirst({ where: { id: p.assetId, organizationId: p.organizationId } });
    if (!a) throw new AssetError("Asset not found.");
    if (a.status !== "ACTIVE") throw new AssetError("A disposed asset cannot be assigned.");
    if (p.userId && !(await tx.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, active: true } }))) throw new AssetError("Unknown employee.");
    await tx.assetAssignment.updateMany({ where: { assetId: a.id, returnedAt: null }, data: { returnedAt: new Date() } });
    if (p.userId) await tx.assetAssignment.create({ data: { assetId: a.id, userId: p.userId } });
    return tx.asset.update({ where: { id: a.id }, data: { assignedToId: p.userId } });
  });
}

// Posts every unposted month up to `upTo` for all active assets. One entry per period and currency.
// Safe to run repeatedly: posted months are skipped, and a unique constraint forbids a month twice.
export async function runDepreciation(db: PrismaClient, p: { organizationId: string; upTo: string; actorId: string }) {
  if (!/^\d{4}-\d{2}$/.test(p.upTo)) throw new AssetError("Choose a month.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Asset" WHERE "organizationId" = ${p.organizationId} AND status = 'ACTIVE' FOR UPDATE`;
    const assets = await tx.asset.findMany({ where: { organizationId: p.organizationId, status: "ACTIVE" }, include: { depreciation: true } });
    const expense = await sys(tx, p.organizationId, "DEPRECIATION_EXPENSE");
    const accum = await sys(tx, p.organizationId, "ACCUM_DEPRECIATION");
    const groups = new Map<string, { period: string; currency: string; items: { assetId: string; amount: Prisma.Decimal }[] }>();
    for (const a of assets) {
      const due = periodsDue(a.purchaseDate, a.usefulLifeMonths, p.upTo, a.depreciation.map((d) => d.period));
      for (const period of due) {
        const idx = [...Array(a.usefulLifeMonths).keys()].find((i) => addMonths(startPeriod(a.purchaseDate), i) === period)!;
        const amount = monthlyAmount(a.cost.toString(), a.salvageValue.toString(), a.usefulLifeMonths, idx);
        if (amount.lte(0)) continue;
        const k = `${period}|${a.currency}`;
        if (!groups.has(k)) groups.set(k, { period, currency: a.currency, items: [] });
        groups.get(k)!.items.push({ assetId: a.id, amount });
      }
    }
    let posted = 0;
    for (const g of [...groups.values()].sort((x, y) => x.period.localeCompare(y.period))) {
      const total = g.items.reduce((s, i) => s.add(i.amount), dec(0));
      const fingerprint = crypto.createHash("sha1").update(g.items.map((i) => i.assetId).sort().join(",")).digest("hex").slice(0, 16);
      const lines: DraftLine[] = [{ accountId: expense.id, debit: total, memo: `Depreciation ${g.period}` }, { accountId: accum.id, credit: total, memo: `Depreciation ${g.period}` }];
      const entry = await postJournal(tx, {
        organizationId: p.organizationId, date: new Date(`${addMonths(g.period, 1)}-01T00:00:00Z`), memo: `Depreciation ${g.period} (${g.currency})`, currency: g.currency,
        sourceType: "DEPRECIATION", idempotencyKey: `depr:${p.organizationId}:${g.period}:${g.currency}:${fingerprint}`, postedById: p.actorId, lines,
      });
      await tx.depreciationEntry.createMany({ data: g.items.map((i) => ({ assetId: i.assetId, period: g.period, amount: i.amount, journalEntryId: entry.id })) });
      posted += g.items.length;
    }
    return { postedLines: posted };
  });
}

export async function assetValue(db: Pick<PrismaClient, "asset" | "depreciationEntry">, assetId: string) {
  const a = await db.asset.findUniqueOrThrow({ where: { id: assetId } });
  const agg = await db.depreciationEntry.aggregate({ where: { assetId }, _sum: { amount: true } });
  const accumulated = agg._sum.amount ?? dec(0);
  return { asset: a, accumulated, netBookValue: round2(a.cost.sub(accumulated)) };
}

export async function disposeAsset(
  db: PrismaClient,
  p: { organizationId: string; assetId: string; date: string; proceeds: string; bankAccountId?: string; actorId: string },
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new AssetError("Enter a valid disposal date.");
  const proceeds = p.proceeds || "0";
  if (!MONEY.test(proceeds)) throw new AssetError("Enter the sale proceeds (0 if scrapped).");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Asset" WHERE id = ${p.assetId} FOR UPDATE`;
    const a = await tx.asset.findFirst({ where: { id: p.assetId, organizationId: p.organizationId }, include: { depreciation: true } });
    if (!a) throw new AssetError("Asset not found.");
    if (a.status === "DISPOSED") return a; // idempotent
    if (p.date < a.purchaseDate) throw new AssetError("The disposal cannot be before the purchase.");
    // Depreciation must be fully posted through the disposal month, otherwise the gain or loss would be wrong
    const due = periodsDue(a.purchaseDate, a.usefulLifeMonths, p.date.slice(0, 7), a.depreciation.map((d) => d.period));
    if (due.length) throw new AssetError(`Run depreciation through ${p.date.slice(0, 7)} before disposing (missing ${due[0]}).`);
    const accumulated = a.depreciation.reduce((s, d) => s.add(d.amount), dec(0));
    const nbv = a.cost.sub(accumulated);
    const proceedsD = round2(proceeds);
    const fixed = await sys(tx, p.organizationId, "FIXED_ASSETS");
    const accum = await sys(tx, p.organizationId, "ACCUM_DEPRECIATION");
    const lines: DraftLine[] = [{ accountId: fixed.id, credit: a.cost, memo: a.number }];
    if (accumulated.gt(0)) lines.push({ accountId: accum.id, debit: accumulated, memo: a.number });
    if (proceedsD.gt(0)) {
      if (!p.bankAccountId) throw new AssetError("Choose the bank account that received the proceeds.");
      lines.push({ accountId: await bankLedger(tx, p.organizationId, p.bankAccountId, a.currency), debit: proceedsD, memo: a.number });
    }
    const diff = proceedsD.sub(nbv); // positive = gain, negative = loss
    if (diff.gt(0)) lines.push({ accountId: (await sys(tx, p.organizationId, "GAIN_DISPOSAL")).id, credit: diff, memo: a.number });
    if (diff.lt(0)) lines.push({ accountId: (await sys(tx, p.organizationId, "LOSS_DISPOSAL")).id, debit: diff.abs(), memo: a.number });
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(`${p.date}T00:00:00Z`), memo: `Disposal of ${a.number}: ${a.name}`, currency: a.currency,
      sourceType: "ASSET_DISPOSAL", sourceId: a.id, idempotencyKey: `asset-dispose:${a.id}`, postedById: p.actorId, lines,
    });
    await tx.assetAssignment.updateMany({ where: { assetId: a.id, returnedAt: null }, data: { returnedAt: new Date() } });
    return tx.asset.update({ where: { id: a.id }, data: { status: "DISPOSED", disposedDate: p.date, disposalProceeds: proceedsD, disposalEntryId: entry.id, assignedToId: null } });
  });
}

// ----- Investments -----

export async function createInvestment(
  db: PrismaClient,
  p: { organizationId: string; name: string; category?: string; investee: string; currency: string; investmentDate: string; ownershipPct?: string; expectedReturn?: string },
) {
  if (p.name.trim().length < 2 || p.investee.trim().length < 2) throw new AssetError("Enter a name and the investee.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.investmentDate)) throw new AssetError("Enter a valid date.");
  if (p.ownershipPct && (!/^\d{1,3}(\.\d{1,2})?$/.test(p.ownershipPct) || Number(p.ownershipPct) > 100)) throw new AssetError("Ownership must be between 0 and 100.");
  return db.$transaction(async (tx) => {
    const number = await seq(tx, p.organizationId, "INVESTMENT", "INV");
    return tx.investment.create({
      data: {
        organizationId: p.organizationId, number, name: p.name.trim(), category: p.category || null, investee: p.investee.trim(), currency: p.currency,
        investmentDate: p.investmentDate, ownershipPct: p.ownershipPct || null, expectedReturn: p.expectedReturn || null,
      },
    });
  });
}

export async function investmentPosition(db: Pick<PrismaClient, "investmentTransaction">, investmentId: string) {
  const rows = await db.investmentTransaction.groupBy({ by: ["kind"], where: { investmentId }, _sum: { amount: true } });
  const sum = (k: string) => rows.find((r) => r.kind === k)?._sum.amount ?? dec(0);
  const recognised = sum("INCOME_RECOGNISED");
  const received = sum("INCOME_RECEIVED");
  return { capital: sum("CAPITAL"), recognised, received, outstanding: recognised.sub(received) };
}

type InvKind = "CAPITAL" | "INCOME_RECOGNISED" | "INCOME_RECEIVED";

// Recognised income and cash actually received are separate events. A request key makes retries safe.
export async function recordInvestmentTransaction(
  db: PrismaClient,
  p: { organizationId: string; investmentId: string; kind: InvKind; amount: string; date: string; bankAccountId?: string; note?: string; requestKey: string; actorId: string },
) {
  if (!MONEY.test(p.amount) || Number(p.amount) <= 0) throw new AssetError("Enter a positive amount.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new AssetError("Enter a valid date.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Investment" WHERE id = ${p.investmentId} FOR UPDATE`;
    const key = `investment-tx:${p.requestKey}`;
    const prior = await tx.journalEntry.findUnique({ where: { idempotencyKey: key } });
    if (prior) return tx.investmentTransaction.findFirstOrThrow({ where: { journalEntryId: prior.id } });
    const inv = await tx.investment.findFirst({ where: { id: p.investmentId, organizationId: p.organizationId } });
    if (!inv) throw new AssetError("Investment not found.");
    const pos = await investmentPosition(tx, inv.id);
    let lines: DraftLine[];
    if (p.kind === "CAPITAL") {
      if (!p.bankAccountId) throw new AssetError("Choose the bank account the capital was paid from.");
      lines = [{ accountId: (await sys(tx, p.organizationId, "INVESTMENTS")).id, debit: p.amount }, { accountId: await bankLedger(tx, p.organizationId, p.bankAccountId, inv.currency), credit: p.amount }];
    } else if (p.kind === "INCOME_RECOGNISED") {
      lines = [{ accountId: (await sys(tx, p.organizationId, "INVESTMENT_RECEIVABLE")).id, debit: p.amount }, { accountId: (await sys(tx, p.organizationId, "INVESTMENT_INCOME")).id, credit: p.amount }];
    } else {
      if (!p.bankAccountId) throw new AssetError("Choose the bank account that received the cash.");
      if (dec(p.amount).gt(pos.outstanding)) throw new AssetError(`Only ${pos.outstanding.toString()} ${inv.currency} of recognised income is outstanding.`);
      lines = [{ accountId: await bankLedger(tx, p.organizationId, p.bankAccountId, inv.currency), debit: p.amount }, { accountId: (await sys(tx, p.organizationId, "INVESTMENT_RECEIVABLE")).id, credit: p.amount }];
    }
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(`${p.date}T00:00:00Z`), memo: `${inv.number} ${p.kind.toLowerCase().replace("_", " ")}`, currency: inv.currency,
      sourceType: "INVESTMENT", sourceId: inv.id, idempotencyKey: key, postedById: p.actorId, lines,
    });
    return tx.investmentTransaction.create({
      data: { investmentId: inv.id, kind: p.kind, amount: p.amount, date: p.date, note: p.note || null, journalEntryId: entry.id, createdById: p.actorId },
    });
  });
}
