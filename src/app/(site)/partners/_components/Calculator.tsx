"use client";

import { useState } from "react";

export type CalcType = { key: string; name: string; rate: number | null };

// A plain estimate: monthly price per client x number of clients x commission. It is labelled as an estimate on the page.
export function Calculator({ types, price, currency }: { types: CalcType[]; price: number; currency: string }) {
  const fixed = types.filter((t) => t.rate !== null);
  const [type, setType] = useState(fixed[fixed.length - 1]?.key ?? "");
  const [clients, setClients] = useState(10);
  const [monthly, setMonthly] = useState(price);
  const rate = fixed.find((t) => t.key === type)?.rate ?? 0;
  const perMonth = Math.max(0, clients) * Math.max(0, monthly) * (rate / 100);
  const money = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  return (
    <div className="hs-calc">
      <div className="hs-form">
        <div className="hs-field"><label htmlFor="calc-type">Partner type</label>
          <select id="calc-type" className="hs-input" value={type} onChange={(e) => setType(e.target.value)}>
            {fixed.map((t) => <option key={t.key} value={t.key}>{t.name} ({t.rate}%)</option>)}
          </select></div>
        <div className="hs-form-row">
          <div className="hs-field"><label htmlFor="calc-clients">Paying clients</label><input id="calc-clients" type="number" min={0} max={100000} className="hs-input" value={clients} onChange={(e) => setClients(Number(e.target.value) || 0)} /></div>
          <div className="hs-field"><label htmlFor="calc-price">Monthly price per client ({currency})</label><input id="calc-price" type="number" min={0} step="any" className="hs-input" value={monthly} onChange={(e) => setMonthly(Number(e.target.value) || 0)} /></div>
        </div>
      </div>
      <div className="hs-calc-out" role="status" aria-live="polite">
        <span>You could earn about</span>
        <strong>{money(perMonth)}<small> / month</small></strong>
        <span>{money(perMonth * 12)} a year, every year the clients keep paying</span>
      </div>
      <p className="hs-hint">An estimate only. Real commission is paid on the money Hifi actually receives, so refunds and cancellations reduce it.</p>
    </div>
  );
}
