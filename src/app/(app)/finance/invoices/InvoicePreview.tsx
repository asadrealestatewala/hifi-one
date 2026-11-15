"use client";

import { useEffect, useRef, useState } from "react";

// An on-screen copy of the invoice PDF (src/lib/pdf.ts, invoiceModern / invoiceMinimal) that follows the editor as you type.
// The colours below are the document's own print colours, the same values the PDF uses, not app theme colours.
// The PDF stays the official copy: amounts there are computed by the server.
const NAVY = "#0f1b4d", INDIGO = "#3b44c4", LILAC = "#c7cbff", RULE = "#e3e5f5";
const PAGE_W = 794, PAGE_H = 1123;

export type PreviewLine = { desc: string; qty: string; price: string };
export type PreviewProps = {
  template: string; currency: string; number: string; issued: string; due: string;
  company: { name: string; lines: string[] };
  client: { name: string; billingAddress: string | null; taxId: string | null } | null;
  lines: PreviewLine[]; taxRate: string; notes: string;
  bank: [string, string][]; bankInstructions?: string; footer: string; stamp: boolean;
};

const toNum = (s: string) => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, c: string) => `${c} ${Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

export default function InvoicePreview(p: PreviewProps) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / PAGE_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rows = p.lines.filter((l) => l.desc.trim() || toNum(l.price) > 0).map((l) => ({ ...l, amount: round2(toNum(l.qty) * toNum(l.price)) }));
  const sub = round2(rows.reduce((s, r) => s + r.amount, 0));
  const tax = round2(sub * Math.min(toNum(p.taxRate), 100) / 100);
  const total = round2(sub + tax);
  const modern = p.template !== "minimal";
  const lineBlock = (r: (typeof rows)[number], i: number) => {
    const [title, ...rest] = (r.desc || "Description").split("\n");
    const sub2 = [...rest];
    if (toNum(r.qty) !== 1) sub2.push(`${r.qty || 0} x ${money(toNum(r.price), p.currency)}`);
    return (
      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 24, padding: modern ? "12px 0" : "14px 0", borderBottom: `1px solid ${modern ? RULE : "#ddd"}` }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: r.desc ? "#111" : "#aaa", whiteSpace: "pre-wrap" }}>{title}</div>
          {sub2.length > 0 && <div style={{ fontSize: 11.5, color: "#555", whiteSpace: "pre-wrap" }}>{sub2.join("\n")}</div>}
        </div>
        <div style={{ fontSize: 13, whiteSpace: "nowrap" }}>{money(r.amount, p.currency)}</div>
      </div>
    );
  };
  const totals: [string, string][] = [["Subtotal", money(sub, p.currency)]];
  if (tax > 0) totals.push([`Tax (${p.taxRate}%)`, money(tax, p.currency)], ["Total", money(total, p.currency)]);
  const label = { fontSize: 10, fontWeight: 700, letterSpacing: 1.3, color: INDIGO } as const;
  const bankAndFooter = (
    <div style={{ marginTop: 28, fontSize: 12 }}>
      {p.bank.length > 0 && <>
        <div style={{ fontWeight: 700, color: "#555", fontSize: 11.5 }}>Payment instructions</div>
        <div>{p.bank.map(([k, v]) => `${k}: ${v}`).join("   ")}</div>
        {p.bankInstructions && <div style={{ color: "#555" }}>{p.bankInstructions}</div>}
      </>}
      {p.notes && <div style={{ marginTop: 14, color: "#555", whiteSpace: "pre-wrap" }}>{p.notes}</div>}
      {p.footer && <div style={{ marginTop: 14, color: "#666", fontSize: 10.5, whiteSpace: "pre-wrap" }}>{p.footer}</div>}
      {p.stamp && (
        <div style={{ marginTop: 24, marginLeft: "auto", width: 185, textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/doc-assets/stamp.png" alt="Company stamp" style={{ height: 96, margin: "0 auto" }} />
          <div style={{ borderTop: "1px solid #999", marginTop: 8, paddingTop: 4, fontSize: 10, color: "#555" }}>Company stamp</div>
        </div>
      )}
    </div>
  );
  return (
    <div ref={box} className="w-full overflow-hidden rounded-xl border border-border bg-hover/40" style={{ height: PAGE_H * scale }} aria-label="Live invoice preview">
      <div style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})`, transformOrigin: "top left", background: "#fff", color: "#111", fontFamily: "Helvetica, Arial, sans-serif", position: "relative", overflow: "hidden" }}>
        {modern ? (
          <>
            <div style={{ height: 144, background: `linear-gradient(90deg, ${NAVY}, ${INDIGO})`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 64px 0 53px" }}>
              <div style={{ width: 69, height: 69, background: "#fff", borderRadius: 13, display: "grid", placeItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="" style={{ width: 56 }} />
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 32, letterSpacing: 4 }}>INVOICE</div>
                <div style={{ color: LILAC, fontSize: 12, letterSpacing: 1.3, marginTop: 6 }}>{p.number}</div>
              </div>
            </div>
            <div style={{ padding: "34px 64px 0", display: "grid", gridTemplateColumns: "230px 1fr 200px", gap: 24 }}>
              <div><div style={label}>FROM</div><div style={{ fontWeight: 700, fontSize: 12.5, marginTop: 6 }}>{p.company.name}</div>{p.company.lines.map((l) => <div key={l} style={{ fontSize: 10.5, color: "#555" }}>{l}</div>)}</div>
              <div><div style={label}>BILLED TO</div><div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 6, color: p.client ? "#111" : "#aaa" }}>{p.client?.name ?? "Choose a client"}</div>
                {p.client?.billingAddress && <div style={{ fontSize: 11.5, color: "#555", whiteSpace: "pre-wrap" }}>{p.client.billingAddress}</div>}
                {p.client?.taxId && <div style={{ fontSize: 11.5, color: "#555" }}>Tax ID {p.client.taxId}</div>}</div>
              <div style={{ fontSize: 12 }}>{([["ISSUED", p.issued], ["DUE", p.due], ["CURRENCY", p.currency]] as const).map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={label}>{k}</span><span>{v}</span></div>)}</div>
            </div>
            <div style={{ padding: "30px 64px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", ...label, paddingBottom: 8, borderBottom: `2px solid ${NAVY}` }}><span>SERVICE</span><span>AMOUNT</span></div>
              {rows.length ? rows.map(lineBlock) : <div style={{ padding: "14px 0", color: "#aaa", fontSize: 13 }}>Add a line to see it here</div>}
              <div style={{ marginLeft: "auto", width: 290, marginTop: 18, fontSize: 12 }}>
                {totals.map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", color: "#333", marginBottom: 6 }}><span>{k}</span><span>{v}</span></div>)}
                <div style={{ marginTop: 8, background: NAVY, color: "#fff", borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 13.5 }}><span>Amount payable</span><span>{money(total, p.currency)}</span></div>
              </div>
              {bankAndFooter}
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 21, background: INDIGO }} />
          </>
        ) : (
          <div style={{ padding: "62px 80px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" style={{ height: 42 }} />
              <div style={{ fontSize: 12, color: "#777", letterSpacing: 4 }}>{`INVOICE  ${p.number}`}</div>
            </div>
            <div style={{ marginTop: 18 }}><div style={{ fontWeight: 700, fontSize: 12 }}>{p.company.name}</div>{p.company.lines.map((l) => <div key={l} style={{ fontSize: 10.5, color: "#777" }}>{l}</div>)}</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36 }}>
              <div><div style={{ fontSize: 10.5, color: "#999" }}>Billed to</div><div style={{ fontSize: 13.5, color: p.client ? "#111" : "#aaa" }}>{p.client?.name ?? "Choose a client"}</div>
                {p.client?.billingAddress && <div style={{ fontSize: 11.5, color: "#666", whiteSpace: "pre-wrap" }}>{p.client.billingAddress}</div>}</div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 10.5, color: "#999" }}>Issued / due</div><div style={{ fontSize: 13.5 }}>{`${p.issued} / ${p.due}`}</div><div style={{ fontSize: 10.5, color: "#999" }}>Currency {p.currency}</div></div>
            </div>
            <div style={{ marginTop: 36, borderTop: "1px solid #222" }}>{rows.length ? rows.map(lineBlock) : <div style={{ padding: "14px 0", color: "#aaa", fontSize: 13 }}>Add a line to see it here</div>}</div>
            <div style={{ marginLeft: "auto", width: 340, marginTop: 14, fontSize: 12, color: "#666" }}>{totals.map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>{k}</span><span>{v}</span></div>)}</div>
            <div style={{ borderTop: "1px solid #222", marginTop: 8, paddingTop: 12, display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 17 }}><span>Amount payable</span><span>{money(total, p.currency)}</span></div>
            {bankAndFooter}
          </div>
        )}
      </div>
    </div>
  );
}
