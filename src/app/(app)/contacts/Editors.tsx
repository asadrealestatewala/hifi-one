"use client";

import { useState } from "react";

type Entry = { type: string; value: string };

// Repeatable phone or email rows for the in-place editors. Field names match what the form actions read.
export function EntryEditor({ kind, initial }: { kind: "phone" | "email"; initial: Entry[] }) {
  const [rows, setRows] = useState<Entry[]>(initial.length ? initial : [{ type: kind === "phone" ? "MOBILE" : "WORK", value: "" }]);
  const types = kind === "phone" ? ["WORK", "MOBILE", "HOME", "WHATSAPP", "OTHER"] : ["WORK", "PERSONAL", "BILLING", "OTHER"];
  const set = (i: number, p: Partial<Entry>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-2">
      <p className="label">{kind === "phone" ? "Phone numbers" : "Email addresses"}</p>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <input name={`${kind}Value`} type={kind === "email" ? "email" : "text"} inputMode={kind === "phone" ? "tel" : undefined} value={r.value} onChange={(e) => set(i, { value: e.target.value })} placeholder={kind === "phone" ? "+92 316 8080801" : "name@company.com"} aria-label={`${kind} ${i + 1}`} className="input" />
          <select name={`${kind}Type`} value={r.type} onChange={(e) => set(i, { type: e.target.value })} aria-label={`${kind} ${i + 1} type`} className="input !w-32">{types.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}</select>
          {rows.length > 1 && <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-brand" aria-label={`Remove ${kind}`}>×</button>}
        </div>
      ))}
      {rows.length < 10 && <button type="button" onClick={() => setRows([...rows, { type: kind === "phone" ? "MOBILE" : "PERSONAL", value: "" }])} className="text-sm font-medium text-primary">+ Add {kind}</button>}
    </div>
  );
}

export function PairsEditor({ initial }: { initial: Record<string, string> }) {
  const [rows, setRows] = useState<[string, string][]>(Object.entries(initial));
  return (
    <div className="space-y-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <input name="cfKey" value={k} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} placeholder="Field (e.g. Best contact method)" aria-label="Field name" className="input" />
          <input name="cfValue" value={v} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} placeholder="Value" aria-label="Field value" className="input" />
          <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-brand" aria-label="Remove field">×</button>
        </div>
      ))}
      {rows.length < 20 && <button type="button" onClick={() => setRows([...rows, ["", ""]])} className="text-sm font-medium text-primary">+ Add a field</button>}
    </div>
  );
}

type Addr = { addressLine: string; city: string; state: string; country: string; postalCode: string };

// Shipping address with a button that copies the billing address in, as the reference does.
export function ShippingFields({ initial, billing }: { initial: Addr; billing: Addr }) {
  const [v, setV] = useState(initial);
  const f = (k: keyof Addr, label: string, name: string, wide?: boolean) => (
    <div className={wide ? "sm:col-span-2" : ""}><label className="label" htmlFor={`sh-${k}`}>{label}</label><input id={`sh-${k}`} name={name} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="input" /></div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex items-center justify-between sm:col-span-2"><span className="text-xs text-muted">Where goods and documents are sent</span><button type="button" onClick={() => setV(billing)} className="text-sm font-medium text-primary">Copy billing address</button></div>
      {f("addressLine", "Street address", "shipAddressLine", true)}{f("city", "City", "shipCity")}{f("state", "State / region", "shipState")}{f("country", "Country", "shipCountry")}{f("postalCode", "Postal code", "shipPostalCode")}
    </div>
  );
}
