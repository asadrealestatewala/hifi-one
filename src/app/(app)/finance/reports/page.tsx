import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { consolidateRows, consolidatedBalanceSheet, getBaseCurrency, ratesOn } from "@/lib/fx";
import { AGING_BUCKETS, buildBalanceSheet, buildIncomeStatement, groupByCurrency, loadBalances, loadCashMovement, loadPayablesAging, loadReceivablesAging, type Line } from "@/lib/statements";
import { salesTaxReport } from "@/lib/tax";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const TABS = [["pl", "Profit & Loss"], ["bs", "Balance Sheet"], ["cpl", "Consolidated P&L"], ["cbs", "Consolidated Balance Sheet"], ["cash", "Cash Movement"], ["aging", "Receivables Aging"], ["ap", "Payables Aging"], ["tax", "Sales Tax"]] as const;

function Section({ title, lines, cur, total, bold }: { title: string; lines: Line[]; cur: string; total?: { label: string; value: { toString(): string } }; bold?: boolean }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {lines.length === 0 && <p className="text-sm text-muted">None</p>}
      {lines.map((l) => (
        <div key={l.code} className="flex justify-between text-sm"><span><span className="text-muted">{l.code}</span> {l.name}</span><span>{formatMoney(l.amount.toString(), cur)}</span></div>
      ))}
      {total && <div className={`flex justify-between text-sm border-t border-border pt-1 ${bold ? "font-bold" : "font-semibold"}`}><span>{total.label}</span><span>{formatMoney(total.value.toString(), cur)}</span></div>}
    </div>
  );
}

export default async function Reports({ searchParams }: { searchParams: Promise<{ type?: string; from?: string; to?: string }> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const type = TABS.some(([k]) => k === sp.type) ? (sp.type as string) : "pl";
  const today = new Date().toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : `${to.slice(0, 7)}-01`;
  const org = user.organizationId;
  const generated = new Date().toLocaleString();
  const q = (t: string) => `/finance/reports?type=${t}&from=${from}&to=${to}`;

  let body: React.ReactNode = null;
  if (type === "pl" || type === "bs") {
    const rows = type === "pl" ? await loadBalances(db, org, { from, to }) : await loadBalances(db, org, { to });
    const groups = [...groupByCurrency(rows)];
    body = groups.length === 0 ? <div className="card text-sm text-muted">No postings in this period.</div> : groups.map(([cur, r]) => {
      if (type === "pl") {
        const s = buildIncomeStatement(r);
        return (
          <section key={cur} className="card space-y-4">
            <h2 className="font-semibold">Profit & Loss, {cur}</h2>
            <Section title="Revenue" lines={s.revenue} cur={cur} total={{ label: "Total revenue", value: s.totals.revenue }} />
            <Section title="Direct costs" lines={s.direct} cur={cur} total={{ label: "Gross profit", value: s.totals.grossProfit }} />
            <Section title="Operating expenses" lines={s.opex} cur={cur} total={{ label: "Operating profit", value: s.totals.operatingProfit }} />
            <Section title="Other income" lines={s.otherIncome} cur={cur} />
            <Section title="Other expenses" lines={s.otherExpense} cur={cur} total={{ label: "Net profit", value: s.totals.netProfit }} bold />
          </section>
        );
      }
      const b = buildBalanceSheet(r);
      return (
        <section key={cur} className="card space-y-4">
          <h2 className="font-semibold">Balance Sheet as at {to}, {cur}</h2>
          <Section title="Assets" lines={b.assets} cur={cur} total={{ label: "Total assets", value: b.totals.assets }} bold />
          <Section title="Liabilities" lines={b.liabilities} cur={cur} total={{ label: "Total liabilities", value: b.totals.liabilities }} />
          <Section title="Equity" lines={b.equity} cur={cur} />
          <div className="flex justify-between text-sm"><span>Earnings to date (books not yet closed)</span><span>{formatMoney(b.earnings.toString(), cur)}</span></div>
          <div className="flex justify-between text-sm font-bold border-t border-border pt-1"><span>Total liabilities and equity</span><span>{formatMoney(b.totals.liabilitiesAndEquity.toString(), cur)}</span></div>
          <p className={`text-xs ${b.balanced ? "text-green-700" : "text-brand font-semibold"}`}>{b.balanced ? "Balanced: assets equal liabilities plus equity." : "OUT OF BALANCE. Investigate before relying on this report."}</p>
        </section>
      );
    });
  } else if (type === "cpl" || type === "cbs") {
    const base = await getBaseCurrency(db, org);
    const raw = type === "cpl" ? await loadBalances(db, org, { from, to }) : await loadBalances(db, org, { to });
    const currencies = [...new Set(raw.map((r) => r.currency))];
    const rates = await ratesOn(db, org, currencies, to);
    const { rows, missing } = consolidateRows(raw, base, rates);
    const used = currencies.filter((c) => c !== base && !missing.includes(c));
    const notice = (
      <div className="card text-sm space-y-1">
        <p>All amounts are converted into <strong>{base}</strong> using the rate in force on {to} for each currency{used.length ? `: ${used.map((c) => `1 ${c} = ${rates.get(c)!.toString()} ${base}`).join("; ")}` : ""}.
          Period results use that single rate, so this is a presentation conversion, not an accounting revaluation (no exchange gains or losses are booked).</p>
        {missing.length > 0 && <p role="alert" className="text-brand font-semibold">Not included: {missing.join(", ")}. No exchange rate is set on or before {to}. <Link className="underline" href="/settings/exchange-rates">Add a rate</Link>.</p>}
      </div>
    );
    if (rows.length === 0) {
      body = <>{notice}<div className="card text-sm text-muted">Nothing to show for this period.</div></>;
    } else if (type === "cpl") {
      const s = buildIncomeStatement(rows);
      body = (
        <>{notice}
          <section className="card space-y-4">
            <h2 className="font-semibold">Consolidated Profit & Loss, {base}</h2>
            <Section title="Revenue" lines={s.revenue} cur={base} total={{ label: "Total revenue", value: s.totals.revenue }} />
            <Section title="Direct costs" lines={s.direct} cur={base} total={{ label: "Gross profit", value: s.totals.grossProfit }} />
            <Section title="Operating expenses" lines={s.opex} cur={base} total={{ label: "Operating profit", value: s.totals.operatingProfit }} />
            <Section title="Other income" lines={s.otherIncome} cur={base} />
            <Section title="Other expenses" lines={s.otherExpense} cur={base} total={{ label: "Net profit", value: s.totals.netProfit }} bold />
          </section>
        </>
      );
    } else {
      const b = consolidatedBalanceSheet(rows);
      body = (
        <>{notice}
          <section className="card space-y-4">
            <h2 className="font-semibold">Consolidated Balance Sheet as at {to}, {base}</h2>
            <Section title="Assets" lines={b.assets} cur={base} total={{ label: "Total assets", value: b.totals.assets }} bold />
            <Section title="Liabilities" lines={b.liabilities} cur={base} total={{ label: "Total liabilities", value: b.totals.liabilities }} />
            <Section title="Equity" lines={b.equity} cur={base} />
            <div className="flex justify-between text-sm"><span>Earnings to date (books not yet closed)</span><span>{formatMoney(b.earnings.toString(), base)}</span></div>
            {!b.rounding.isZero() && <div className="flex justify-between text-sm"><span>Currency conversion rounding</span><span>{formatMoney(b.rounding.toString(), base)}</span></div>}
            <div className="flex justify-between text-sm font-bold border-t border-border pt-1"><span>Total liabilities and equity</span><span>{formatMoney(b.totals.liabilitiesAndEquity.add(b.rounding).toString(), base)}</span></div>
            <p className={`text-xs ${b.balanced ? "text-green-700" : "text-brand font-semibold"}`}>{b.balanced ? "Balanced: assets equal liabilities plus equity." : "OUT OF BALANCE. Investigate before relying on this report."}</p>
          </section>
        </>
      );
    }
  } else if (type === "tax") {
    const report = await salesTaxReport(db, org, { from, to });
    body = report.length === 0 ? <div className="card text-sm text-muted">No invoices were issued in this period.</div> : (
      <>
        {report.map((r) => (
          <section key={r.currency} className="card overflow-x-auto">
            <h2 className="font-semibold mb-2">Sales tax, {r.currency}, {from} to {to}</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Rate</th><th className="pr-4 text-right">Invoices</th><th className="pr-4 text-right">Taxable sales</th><th className="text-right">Tax charged</th></tr></thead>
              <tbody>{r.lines.map((l) => <tr key={l.rate} className="border-t border-border"><td className="py-2 pr-4">{l.rate}%</td><td className="pr-4 text-right">{l.count}</td><td className="pr-4 text-right">{formatMoney(l.taxable.toString(), r.currency)}</td><td className="text-right">{formatMoney(l.tax.toString(), r.currency)}</td></tr>)}</tbody>
            </table>
            <dl className="text-sm mt-3 ml-auto w-72 space-y-1">
              <div className="flex justify-between"><dt>Tax charged</dt><dd>{formatMoney(r.collected.toString(), r.currency)}</dd></div>
              <div className="flex justify-between"><dt>Less tax reversed by credit notes</dt><dd>{formatMoney(r.reversed.toString(), r.currency)}</dd></div>
              <div className="flex justify-between font-bold border-t border-border pt-1"><dt>Net tax for the period</dt><dd>{formatMoney(r.net.toString(), r.currency)}</dd></div>
            </dl>
          </section>
        ))}
        <p className="text-xs text-muted">Built from invoices issued in the period (cancelled invoices excluded). Tax paid on purchases is not tracked yet, so this is tax charged, not the amount due to the authority.</p>
      </>
    );
  } else if (type === "ap") {
    const ap = await loadPayablesAging(db, org);
    body = ap.byCurrency.size === 0 ? <div className="card text-sm text-muted">No unpaid posted vendor bills.</div> : (
      <>
        {[...ap.byCurrency].map(([cur, m]) => (
          <section key={cur} className="card overflow-x-auto">
            <h2 className="font-semibold mb-2">Payables aging, {cur}</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr>{AGING_BUCKETS.map((b) => <th key={b} className="py-2 pr-4 text-right">{b}</th>)}<th className="text-right">Total</th></tr></thead>
              <tbody><tr className="border-t border-border">
                {AGING_BUCKETS.map((b) => <td key={b} className="py-2 pr-4 text-right">{formatMoney((m.get(b) ?? 0).toString(), cur)}</td>)}
                <td className="text-right font-semibold">{formatMoney([...m.values()].reduce((a, v) => a + Number(v), 0), cur)}</td>
              </tr></tbody>
            </table>
            <ul className="text-sm mt-3">{ap.detail.filter((d) => d.currency === cur).map((d) => <li key={d.id} className="flex justify-between border-t border-border py-1"><span>{d.number} · {d.vendor} · {d.bucket}</span><span>{formatMoney(d.amount.toString(), cur)}</span></li>)}</ul>
          </section>
        ))}
        <p className="text-xs text-muted">Age runs from the day the bill was posted, because vendor bills do not have due dates yet.</p>
      </>
    );
  } else if (type === "cash") {
    const moves = await loadCashMovement(db, org, { from, to });
    body = (
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Cash and bank movement, {from} to {to}</h2>
        {moves.length === 0 ? <p className="text-sm text-muted">No bank accounts linked to the ledger.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Account</th><th className="pr-4 text-right">Opening</th><th className="pr-4 text-right">Money in</th><th className="pr-4 text-right">Money out</th><th className="text-right">Closing</th></tr></thead>
            <tbody>
              {moves.map((m, i) => (
                <tr key={i} className="border-t border-border"><td className="py-2 pr-4">{m.name} ({m.currency})</td>
                  <td className="pr-4 text-right">{formatMoney(m.opening.toString(), m.currency)}</td><td className="pr-4 text-right">{formatMoney(m.inflow.toString(), m.currency)}</td>
                  <td className="pr-4 text-right">{formatMoney(m.outflow.toString(), m.currency)}</td><td className="text-right font-semibold">{formatMoney(m.closing.toString(), m.currency)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted mt-2">A full cash flow statement (operating, investing, financing) is not built yet.</p>
      </section>
    );
  } else {
    const aging = await loadReceivablesAging(db, org);
    body = aging.byCurrency.size === 0 ? <div className="card text-sm text-muted">No outstanding invoices.</div> : (
      <>
        {[...aging.byCurrency].map(([cur, m]) => (
          <section key={cur} className="card overflow-x-auto">
            <h2 className="font-semibold mb-2">Receivables aging, {cur}</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr>{AGING_BUCKETS.map((b) => <th key={b} className="py-2 pr-4 text-right">{b}</th>)}<th className="text-right">Total</th></tr></thead>
              <tbody><tr className="border-t border-border">
                {AGING_BUCKETS.map((b) => <td key={b} className="py-2 pr-4 text-right">{formatMoney((m.get(b) ?? 0).toString(), cur)}</td>)}
                <td className="text-right font-semibold">{formatMoney([...m.values()].reduce((a, v) => a + Number(v), 0), cur)}</td>
              </tr></tbody>
            </table>
            <ul className="text-sm mt-3">
              {aging.detail.filter((d) => d.currency === cur).map((d) => (
                <li key={d.id} className="flex justify-between border-t border-border py-1">
                  <span><Link className="underline" href={`/finance/invoices/${d.id}`}>{d.number}</Link> · {d.client} · {d.bucket}</span><span>{formatMoney(d.outstanding.toString(), cur)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-muted">The total of each currency equals the Accounts Receivable balance in the general ledger.</p>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold">Financial Reports</h1>
        <PrintButton />
      </div>
      <nav aria-label="Report" className="flex flex-wrap gap-2 print:hidden">
        {TABS.map(([k, label]) => <Link key={k} href={q(k)} className={`btn-ghost ${k === type ? "!bg-navy !text-white" : ""}`}>{label}</Link>)}
      </nav>
      {type !== "aging" && type !== "ap" && (
        <form className="flex flex-wrap items-end gap-3 print:hidden">
          <input type="hidden" name="type" value={type} />
          {type !== "bs" && type !== "cbs" && <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>}
          <div><label className="label" htmlFor="to">{type === "bs" || type === "cbs" ? "As at" : "To"}</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
          <button className="btn">Apply</button>
        </form>
      )}
      <p className="text-xs text-muted">Hifi Marketing and Technologies · Confidential · Generated {generated}. Amounts are per currency; only the Consolidated reports convert, using the rates under Exchange Rates.</p>
      {body}
    </div>
  );
}
