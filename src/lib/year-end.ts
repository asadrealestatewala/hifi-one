// Year-end close. For each currency with activity in the year, one balanced entry dated the last day of the year
// brings every revenue, cost and expense account to zero and moves the profit or loss into Retained Earnings.
// Closing entries are tagged YEAR_END_CLOSE: balance sheets include them, profit and loss reports leave them out, so a closed
// year still reports its profit. Running the close again for the same year changes nothing (idempotent per year and currency).
import type { PrismaClient } from "@prisma/client";
import { postJournal } from "./accounting";
import { dec, LedgerError, round2, type DraftLine } from "./ledger-math";
import { loadBalances } from "./statements";

type Db = PrismaClient;
export class YearEndError extends Error {}

const PL_TYPES = ["REVENUE", "DIRECT_COST", "OPEX", "OTHER_INCOME", "OTHER_EXPENSE"];
const CREDIT_NORMAL = new Set(["REVENUE", "OTHER_INCOME"]);

export async function previewYearEnd(db: Db, organizationId: string, year: number) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const rows = (await loadBalances(db, organizationId, { from, to })).filter((r) => PL_TYPES.includes(r.type));
  const byCurrency = new Map<string, { currency: string; accounts: { code: string; name: string; type: string; balance: ReturnType<typeof dec> }[]; profit: ReturnType<typeof dec> }>();
  for (const r of rows) {
    const bal = round2(CREDIT_NORMAL.has(r.type) ? dec(r.credit).sub(r.debit) : dec(r.debit).sub(r.credit)); // positive = normal side
    if (bal.isZero()) continue;
    const g = byCurrency.get(r.currency) ?? { currency: r.currency, accounts: [], profit: dec(0) };
    g.accounts.push({ code: r.code, name: r.name, type: r.type, balance: bal });
    g.profit = g.profit.add(CREDIT_NORMAL.has(r.type) ? bal : bal.neg());
    byCurrency.set(r.currency, g);
  }
  const existing = await db.journalEntry.findMany({ where: { organizationId, sourceType: "YEAR_END_CLOSE", sourceId: String(year) }, select: { number: true, currency: true } });
  return { year, groups: [...byCurrency.values()], alreadyClosed: existing };
}

async function retainedEarnings(db: Db, organizationId: string) {
  const a = (await db.account.findFirst({ where: { organizationId, systemKey: "RETAINED_EARNINGS", active: true } }))
    ?? (await db.account.findFirst({ where: { organizationId, code: "3100", type: "EQUITY", active: true } }));
  if (!a) throw new YearEndError("There is no Retained Earnings equity account. Add one in the Chart of Accounts first.");
  return a;
}

export async function closeYear(db: Db, p: { organizationId: string; year: number; actorId: string; lockBooks: boolean; today: string }) {
  if (!Number.isInteger(p.year) || p.year < 2000 || p.year > 2100) throw new YearEndError("Enter a valid year.");
  const end = `${p.year}-12-31`;
  if (end >= p.today) throw new YearEndError(`${p.year} has not ended yet, so it cannot be closed.`);
  const pending = await db.manualJournal.count({ where: { organizationId: p.organizationId, status: "PENDING", date: { lte: end } } });
  if (pending > 0) throw new YearEndError(`${pending} manual journal${pending === 1 ? " is" : "s are"} still waiting for approval. Approve or reject ${pending === 1 ? "it" : "them"} before closing the year.`);
  const re = await retainedEarnings(db, p.organizationId);
  const prev = await db.journalEntry.count({ where: { organizationId: p.organizationId, sourceType: "YEAR_END_CLOSE", sourceId: String(p.year + 1) } });
  if (prev > 0) throw new YearEndError(`${p.year + 1} has already been closed. Close years in order.`);

  const preview = await previewYearEnd(db, p.organizationId, p.year);
  const accounts = await db.account.findMany({ where: { organizationId: p.organizationId, code: { in: [...new Set(preview.groups.flatMap((g) => g.accounts.map((a) => a.code)))] } } });
  const idOf = new Map(accounts.map((a) => [a.code, a.id]));
  const posted: { currency: string; number: string; profit: string }[] = [];
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"yearend:" + p.organizationId}))`;
    for (const g of preview.groups) {
      const key = `year-end:${p.organizationId}:${p.year}:${g.currency}`;
      const prior = await tx.journalEntry.findUnique({ where: { idempotencyKey: key }, include: { lines: { where: { accountId: re.id } } } });
      if (prior) {
        // Already closed. Fine if nothing changed; otherwise something was posted into the year afterwards and needs a person's decision.
        const moved = prior.lines.reduce((a, l) => a.add(l.credit.toString()).sub(l.debit.toString()), dec(0));
        if (!moved.eq(g.profit)) throw new YearEndError(`${p.year} (${g.currency}) was already closed, but its profit has changed since (closed at ${moved.toFixed(2)}, now ${g.profit.toFixed(2)}). Post a manual adjusting journal for the difference rather than closing again.`);
        posted.push({ currency: g.currency, number: prior.number, profit: g.profit.toString() });
        continue;
      }
      const lines: DraftLine[] = [];
      for (const a of g.accounts) {
        const id = idOf.get(a.code)!;
        // Reverse each account's normal-side balance: revenue is debited, costs and expenses are credited.
        lines.push(CREDIT_NORMAL.has(a.type) ? { accountId: id, debit: a.balance.toString(), memo: `Close ${a.code}` } : { accountId: id, credit: a.balance.toString(), memo: `Close ${a.code}` });
      }
      lines.push(g.profit.gte(0) ? { accountId: re.id, credit: g.profit.toString(), memo: `${p.year} profit` } : { accountId: re.id, debit: g.profit.abs().toString(), memo: `${p.year} loss` });
      try {
        const e = await postJournal(tx, {
          organizationId: p.organizationId, date: new Date(`${end}T12:00:00.000Z`), memo: `Year-end close ${p.year} (${g.currency})`, currency: g.currency, sourceType: "YEAR_END_CLOSE",
          sourceId: String(p.year), idempotencyKey: `year-end:${p.organizationId}:${p.year}:${g.currency}`, postedById: p.actorId, lines,
        });
        posted.push({ currency: g.currency, number: e.number, profit: g.profit.toString() });
      } catch (e) {
        if (e instanceof LedgerError) throw new YearEndError(`${e.message} Reopen the period with a written reason, close the year, then close the period again.`);
        throw e;
      }
    }
    if (p.lockBooks) {
      const cur = await tx.periodLock.findUnique({ where: { organizationId: p.organizationId } });
      if (!cur || cur.lockedThrough < end) {
        await tx.periodLock.upsert({ where: { organizationId: p.organizationId }, create: { organizationId: p.organizationId, lockedThrough: end, lockedById: p.actorId }, update: { lockedThrough: end, lockedById: p.actorId } });
      }
    }
  });
  return posted;
}
