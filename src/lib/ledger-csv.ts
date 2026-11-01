import { tableCsv } from "./crm-contacts";
import type { StatementDoc } from "./pdf";

// A statement as a spreadsheet file: one row per transaction with exact amounts (no currency symbols or rounding) and the
// currency in its own column, in the same order and with the same running balances as the on-screen and PDF statement.
export function statementCsv(d: StatementDoc, kind: "client" | "vendor"): string {
  const L = d.labels ?? { debit: "Charges", credit: "Payments", balance: "Balance" };
  const head = ["Date", "Document", "Description", L.debit, L.credit, L.balance, "Currency"];
  const rows = d.rows.map((r) => [r.date.toISOString().slice(0, 10), r.number, r.description, Number(r.debit) > 0 ? r.debit : "", Number(r.credit) > 0 ? r.credit : "", r.balance, r.currency]);
  const tail = kind === "client" ? d.advances.map((a) => ["", "", "Credit held on account", "", "", a.amount, a.currency]) : [];
  return tableCsv(head, [...rows, ...tail]);
}

export function csvDownload(text: string, filename: string): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "statement";
  return new Response("﻿" + text, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${safe}.csv"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
