// Bank reconciliation.
// A bank account is linked to one ledger account. Statement lines (imported from CSV) are matched one-to-one to ledger
// lines on that account. A reconciliation for a date passes when
//     statement balance = ledger balance - ledger lines not on the statement + statement lines not in the ledger,
// i.e. every difference between the bank and the books is a named, visible item. A passed reconciliation locks its matches.
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { postJournal } from "./accounting";
import { parseCsv } from "./contacts";
import { dec, LedgerError, round2 } from "./ledger-math";

export class BankError extends Error {}
type Db = PrismaClient;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(d));

async function bank(db: Db, organizationId: string, bankAccountId: string) {
  const b = await db.bankAccount.findFirst({ where: { id: bankAccountId, organizationId } });
  if (!b) throw new BankError("Bank account not found.");
  if (!b.ledgerAccountId) throw new BankError("This bank account is not linked to a ledger account yet.");
  return { ...b, ledgerAccountId: b.ledgerAccountId };
}

// ---------- parsing ----------
export function parseDate(s: string): string | null {
  const t = s.trim();
  if (validDate(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // day first, as used in Pakistan, the UAE and the UK
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return validDate(iso) && new Date(iso).getUTCDate() === Number(m[1]) ? iso : null;
}

export function parseAmount(s: string): string | null {
  let t = s.trim().replace(/[\s ]/g, "");
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.endsWith("-")) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith("-")) { neg = !neg; t = t.slice(1); }
  t = t.replace(/^[+]/, "").replace(/[A-Za-z$£€]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const v = dec(t);
  return (neg ? v.neg() : v).toString();
}

export type ParsedStatement = { lines: { date: string; description: string; reference: string | null; amount: string }[]; errors: string[] };

// Columns are found by header name: date, description (or details/narration), amount, reference (optional). If there is
// no single amount column, "money in"/"credit" and "money out"/"debit" columns are combined.
export function parseStatementCsv(text: string): ParsedStatement {
  const rows = parseCsv(text);
  if (rows.length < 2) return { lines: [], errors: ["The file needs a header row and at least one transaction."] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const di = find("date"), ni = find("description", "details", "narration", "particulars", "memo"), ai = head.findIndex((h) => h === "amount" || h === "amount (signed)");
  const ri = find("reference", "ref", "cheque");
  const ci = find("money in", "credit", "deposit"), oi = find("money out", "debit", "withdrawal");
  if (di < 0 || ni < 0 || (ai < 0 && (ci < 0 || oi < 0))) {
    return { lines: [], errors: ["Could not find the columns. The first row must name: date, description, and either amount or money in / money out."] };
  }
  const lines: ParsedStatement["lines"] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const n = i + 2;
    const date = parseDate(r[di] ?? "");
    if (!date) return void errors.push(`Row ${n}: the date "${r[di] ?? ""}" is not valid (use YYYY-MM-DD or DD/MM/YYYY).`);
    let amount: string | null;
    if (ai >= 0) amount = parseAmount(r[ai] ?? "");
    else {
      const inn = (r[ci] ?? "").trim() ? parseAmount(r[ci]) : "0";
      const out = (r[oi] ?? "").trim() ? parseAmount(r[oi]) : "0";
      amount = inn === null || out === null ? null : dec(inn).abs().sub(dec(out).abs()).toString();
    }
    if (amount === null || dec(amount).isZero()) return void errors.push(`Row ${n}: the amount "${r[ai >= 0 ? ai : ci] ?? ""}" is not valid or is zero.`);
    lines.push({ date, description: (r[ni] ?? "").trim().slice(0, 200) || "(no description)", reference: ri >= 0 ? (r[ri] ?? "").trim().slice(0, 80) || null : null, amount });
  });
  return { lines, errors };
}

// ---------- import ----------
// Identical lines inside one file are real (two same-day, same-amount payments), so the occurrence number is part of the key.
export async function importStatement(db: Db, p: { organizationId: string; bankAccountId: string; csv: string; actorId: string }) {
  await bank(db, p.organizationId, p.bankAccountId);
  const parsed = parseStatementCsv(p.csv);
  if (parsed.errors.length > 0) throw new BankError(parsed.errors.slice(0, 5).join(" ") + (parsed.errors.length > 5 ? ` (and ${parsed.errors.length - 5} more)` : ""));
  if (parsed.lines.length === 0) throw new BankError("No transactions found.");
  if (parsed.lines.length > 2000) throw new BankError("Import at most 2000 lines at a time.");
  const seen = new Map<string, number>();
  const data = parsed.lines.map((l) => {
    const base = `${l.date}|${round2(l.amount).toString()}|${l.description.toLowerCase()}|${(l.reference ?? "").toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { organizationId: p.organizationId, bankAccountId: p.bankAccountId, date: l.date, description: l.description, reference: l.reference, amount: round2(l.amount).toString(), dedupKey: createHash("sha256").update(`${base}|${n}`).digest("hex"), importedById: p.actorId };
  });
  const r = await db.bankStatementLine.createMany({ data, skipDuplicates: true });
  return { added: r.count, skipped: data.length - r.count };
}

// ---------- matching ----------
const signed = (l: { debit: { toString(): string }; credit: { toString(): string } }) => dec(l.debit.toString()).sub(l.credit.toString());

async function ledgerLines(db: Db, organizationId: string, ledgerAccountId: string, through?: string) {
  const lines = await db.journalLine.findMany({
    where: { accountId: ledgerAccountId, entry: { organizationId, ...(through ? { date: { lte: new Date(`${through}T23:59:59.999Z`) } } : {}) } },
    include: { entry: { select: { number: true, date: true, memo: true } } }, orderBy: { entry: { date: "asc" } },
  });
  return lines.map((l) => ({ id: l.id, amount: signed(l), date: l.entry.date.toISOString().slice(0, 10), number: l.entry.number, memo: l.memo ?? l.entry.memo ?? "" }));
}

export async function reconciliationView(db: Db, organizationId: string, bankAccountId: string) {
  const b = await bank(db, organizationId, bankAccountId);
  const [lines, stmt, matches] = await Promise.all([
    ledgerLines(db, organizationId, b.ledgerAccountId),
    db.bankStatementLine.findMany({ where: { organizationId, bankAccountId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    db.bankMatch.findMany({ where: { organizationId, bankAccountId } }),
  ]);
  const matchedLedger = new Set(matches.map((m) => m.journalLineId));
  const matchedStmt = new Set(matches.map((m) => m.statementLineId).filter(Boolean) as string[]);
  const unmatchedLedger = lines.filter((l) => !matchedLedger.has(l.id));
  const unmatchedStmt = stmt.filter((s) => !matchedStmt.has(s.id));
  // Suggest only unambiguous pairs: same amount, within 7 days, and neither side has another candidate.
  const day = 86400000;
  const near = (a: string, c: string) => Math.abs(Date.parse(a) - Date.parse(c)) <= 7 * day;
  const suggestions: { statementLineId: string; journalLineId: string }[] = [];
  for (const s of unmatchedStmt) {
    const cands = unmatchedLedger.filter((l) => l.amount.eq(s.amount.toString()) && near(l.date, s.date));
    if (cands.length !== 1) continue;
    const back = unmatchedStmt.filter((x) => dec(x.amount.toString()).eq(cands[0].amount) && near(cands[0].date, x.date));
    if (back.length === 1) suggestions.push({ statementLineId: s.id, journalLineId: cands[0].id });
  }
  return { bank: b, unmatchedLedger, unmatchedStmt, suggestions, matchedCount: matches.length, ledgerBalance: lines.reduce((a, l) => a.add(l.amount), dec(0)) };
}

export async function matchLines(db: Db, p: { organizationId: string; bankAccountId: string; statementLineId: string; journalLineId: string; actorId: string }) {
  const b = await bank(db, p.organizationId, p.bankAccountId);
  return db.$transaction(async (tx) => {
    const s = await tx.bankStatementLine.findFirst({ where: { id: p.statementLineId, organizationId: p.organizationId, bankAccountId: p.bankAccountId } });
    const l = await tx.journalLine.findFirst({ where: { id: p.journalLineId, accountId: b.ledgerAccountId, entry: { organizationId: p.organizationId } } });
    if (!s || !l) throw new BankError("Line not found on this bank account.");
    if (!signed(l).eq(s.amount.toString())) throw new BankError("The amounts differ, so these two lines cannot be matched. Post an entry for the difference first.");
    try {
      return await tx.bankMatch.create({ data: { organizationId: p.organizationId, bankAccountId: p.bankAccountId, statementLineId: s.id, journalLineId: l.id, matchedById: p.actorId } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new BankError("One of these lines is already matched.");
      throw e;
    }
  });
}

export async function acceptSuggestions(db: Db, p: { organizationId: string; bankAccountId: string; actorId: string }) {
  const v = await reconciliationView(db, p.organizationId, p.bankAccountId);
  let n = 0;
  for (const s of v.suggestions) {
    try { await matchLines(db, { ...p, ...s }); n++; } catch (e) { if (!(e instanceof BankError)) throw e; }
  }
  return n;
}

export async function unmatch(db: Db, p: { organizationId: string; matchId: string }) {
  const m = await db.bankMatch.findFirst({ where: { id: p.matchId, organizationId: p.organizationId } });
  if (!m) throw new BankError("Match not found.");
  if (m.reconciliationId) throw new BankError("This match belongs to a completed reconciliation and can no longer be undone.");
  await db.bankMatch.delete({ where: { id: m.id } });
}

// Ledger history from before bank statements were tracked: clear it in one step so only new activity needs matching.
export async function clearOpeningBalance(db: Db, p: { organizationId: string; bankAccountId: string; throughDate: string; actorId: string }) {
  const b = await bank(db, p.organizationId, p.bankAccountId);
  if (!validDate(p.throughDate)) throw new BankError("Enter a valid date.");
  if ((await db.bankReconciliation.count({ where: { organizationId: p.organizationId, bankAccountId: p.bankAccountId } })) > 0) throw new BankError("The opening position can only be set before the first reconciliation.");
  const lines = await ledgerLines(db, p.organizationId, b.ledgerAccountId, p.throughDate);
  const taken = new Set((await db.bankMatch.findMany({ where: { journalLineId: { in: lines.map((l) => l.id) } }, select: { journalLineId: true } })).map((m) => m.journalLineId));
  const todo = lines.filter((l) => !taken.has(l.id));
  await db.bankMatch.createMany({ data: todo.map((l) => ({ organizationId: p.organizationId, bankAccountId: p.bankAccountId, journalLineId: l.id, kind: "OPENING", matchedById: p.actorId })), skipDuplicates: true });
  return todo.length;
}

// A statement line with no ledger entry yet (bank charges, interest, a deposit nobody recorded): post it and match it.
export async function postStatementLine(db: Db, p: { organizationId: string; bankAccountId: string; statementLineId: string; counterAccountId: string; actorId: string }) {
  const b = await bank(db, p.organizationId, p.bankAccountId);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BankStatementLine" WHERE id = ${p.statementLineId} FOR UPDATE`;
    const s = await tx.bankStatementLine.findFirst({ where: { id: p.statementLineId, organizationId: p.organizationId, bankAccountId: p.bankAccountId } });
    if (!s) throw new BankError("Statement line not found.");
    if (await tx.bankMatch.findUnique({ where: { statementLineId: s.id } })) throw new BankError("This line is already matched.");
    if (p.counterAccountId === b.ledgerAccountId) throw new BankError("Choose a different account for the other side of the entry.");
    const counter = await tx.account.findFirst({ where: { id: p.counterAccountId, organizationId: p.organizationId, active: true } });
    if (!counter) throw new BankError("Choose an account for the other side of the entry.");
    const amt = dec(s.amount.toString());
    let entry;
    try {
      entry = await postJournal(tx, {
        organizationId: p.organizationId, date: new Date(`${s.date}T12:00:00.000Z`), memo: `Bank statement: ${s.description}`, currency: b.currency, sourceType: "BANK_STATEMENT",
        sourceId: s.id, idempotencyKey: `bank-line:${s.id}`, postedById: p.actorId,
        lines: amt.gt(0)
          ? [{ accountId: b.ledgerAccountId, debit: amt.toString(), memo: s.description }, { accountId: counter.id, credit: amt.toString(), memo: s.description }]
          : [{ accountId: counter.id, debit: amt.abs().toString(), memo: s.description }, { accountId: b.ledgerAccountId, credit: amt.abs().toString(), memo: s.description }],
      });
    } catch (e) {
      if (e instanceof LedgerError) throw new BankError(e.message);
      throw e;
    }
    const line = await tx.journalLine.findFirstOrThrow({ where: { entryId: entry.id, accountId: b.ledgerAccountId } });
    await tx.bankMatch.create({ data: { organizationId: p.organizationId, bankAccountId: p.bankAccountId, statementLineId: s.id, journalLineId: line.id, matchedById: p.actorId } });
    return entry;
  });
}

// ---------- completing ----------
export async function reconcile(db: Db, p: { organizationId: string; bankAccountId: string; statementDate: string; statementBalance: string; actorId: string }) {
  const b = await bank(db, p.organizationId, p.bankAccountId);
  if (!validDate(p.statementDate)) throw new BankError("Enter the statement date.");
  const sb = parseAmount(p.statementBalance);
  if (sb === null) throw new BankError("Enter the closing balance shown on the statement.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bankrec:" + b.id}))`;
    const lines = await ledgerLines(tx as unknown as Db, p.organizationId, b.ledgerAccountId, p.statementDate);
    const matches = await tx.bankMatch.findMany({ where: { organizationId: p.organizationId, bankAccountId: b.id } });
    const matchedL = new Set(matches.map((m) => m.journalLineId));
    const matchedS = new Set(matches.map((m) => m.statementLineId).filter(Boolean) as string[]);
    const stmt = await tx.bankStatementLine.findMany({ where: { organizationId: p.organizationId, bankAccountId: b.id, date: { lte: p.statementDate } } });
    const ledger = lines.reduce((a, l) => a.add(l.amount), dec(0));
    const outstanding = lines.filter((l) => !matchedL.has(l.id)).reduce((a, l) => a.add(l.amount), dec(0));
    const unmatched = stmt.filter((s) => !matchedS.has(s.id)).reduce((a, s) => a.add(s.amount.toString()), dec(0));
    const difference = dec(sb).sub(ledger.sub(outstanding).add(unmatched));
    if (!difference.isZero()) {
      throw new BankError(`Not reconciled yet: the statement balance and the books differ by ${difference.toFixed(2)} after allowing for unmatched items. Check that every statement line up to ${p.statementDate} is imported, and that the balance you typed is the closing balance.`);
    }
    const rec = await tx.bankReconciliation.create({
      data: { organizationId: p.organizationId, bankAccountId: b.id, statementDate: p.statementDate, statementBalance: sb, ledgerBalance: ledger.toString(), outstandingLedger: outstanding.toString(), unmatchedStatement: unmatched.toString(), difference: "0", completedById: p.actorId },
    });
    // Everything matched so far is now part of a completed reconciliation and can no longer be undone.
    await tx.bankMatch.updateMany({ where: { organizationId: p.organizationId, bankAccountId: b.id, reconciliationId: null }, data: { reconciliationId: rec.id } });
    return rec;
  });
}
