// Server-side PDF documents. Builders take plain data (so they are easy to test) and return the file as a Buffer.
// Standard PDF fonts only cover Western European characters. Anything else (for example Urdu or Arabic script) is shown as "?"
// and the document says so, rather than printing wrong letters silently. Full right-to-left support needs a different renderer.
import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import path from "node:path";

export type DocConfig = {
  showRegisteredOffice: boolean;
  showSalesCentre: boolean;
  showPhones: boolean;
  showEmail: boolean;
  showWebsite: boolean;
  showRegistrationNo: boolean;
  showTaxId: boolean;
  showBank: boolean;
  footerText: string;
  accent: string;
  template: string; // invoice layout, see INVOICE_TEMPLATES
  showSignature: boolean; // signature and stamp, used by the retired Hifi Signature layout
  showStamp: boolean; // company stamp at the end of official documents
};

// The layouts staff can choose for new invoices
export const INVOICE_TEMPLATES = [
  { key: "modern", label: "Modern Indigo", note: "Navy to indigo header band with the logo." },
  { key: "minimal", label: "Minimal", note: "White space, thin lines and a small logo." },
] as const;
export const TEMPLATE_KEYS: string[] = INVOICE_TEMPLATES.map((t) => t.key);
export const DEFAULT_INVOICE_TEMPLATE = "modern";
// Retired layouts: no longer offered, but invoices already issued with them keep printing exactly as they were sent
export const RETIRED_TEMPLATES = [
  { key: "standard", label: "Standard (retired)" },
  { key: "hifi-signature", label: "Hifi Signature (retired)" },
] as const;
const LAYOUT_KEYS: string[] = [...TEMPLATE_KEYS, ...RETIRED_TEMPLATES.map((t) => t.key)];
export const templateLabel = (k: string) => [...INVOICE_TEMPLATES, ...RETIRED_TEMPLATES].find((t) => t.key === k)?.label ?? k;

export const DEFAULT_DOC_CONFIG: DocConfig = {
  showRegisteredOffice: true, showSalesCentre: true, showPhones: true, showEmail: true, showWebsite: true, showRegistrationNo: true, showTaxId: true,
  showBank: true, footerText: "", accent: "#e11d1d", template: "standard", showSignature: true, showStamp: true,
};

export function mergeConfig(c: Partial<DocConfig> | null | undefined): DocConfig {
  const m: DocConfig = { ...DEFAULT_DOC_CONFIG };
  for (const k of Object.keys(DEFAULT_DOC_CONFIG) as (keyof DocConfig)[]) {
    const v = c?.[k];
    if (v !== undefined && typeof v === typeof DEFAULT_DOC_CONFIG[k]) (m as Record<string, unknown>)[k] = v;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(m.accent)) m.accent = DEFAULT_DOC_CONFIG.accent;
  // Unknown or missing layout means an invoice issued before templates existed, which used the plain layout
  if (!LAYOUT_KEYS.includes(m.template)) m.template = DEFAULT_DOC_CONFIG.template;
  return m;
}

export type Company = {
  legalName: string; registeredOffice?: string | null; salesCentre?: string | null; globalUan?: string | null; localUan?: string | null;
  email?: string | null; website?: string | null; registrationNo?: string | null; taxId?: string | null; legalNotice?: string | null; invoiceFooter?: string | null;
};
export type Bank = { bankName?: string | null; accountHolder?: string | null; accountNumber?: string | null; iban?: string | null; swift?: string | null; routingCode?: string | null; currency?: string | null; paymentInstructions?: string | null };

type Ctx = { doc: PDFKit.PDFDocument; lossy: { value: boolean }; cfg: DocConfig };

// Latin-1 plus the common punctuation that WinAnsi also has. Everything else becomes "?".
const OK = /[ -~ -ÿ‘’“”–—•€]/;
export function pdfText(s: string | null | undefined): { text: string; lossy: boolean } {
  let lossy = false;
  const text = (s ?? "").replace(/[\r\t]/g, " ").split("").map((ch) => {
    if (ch === "\n" || OK.test(ch)) return ch;
    lossy = true;
    return "?";
  }).join("");
  return { text, lossy };
}

export function pdfMoney(amount: { toString(): string } | number | string, currency: string): string {
  const n = Number(amount.toString());
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${currency} ${fixed}`;
}

const fmtDate = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? d : d.toISOString().slice(0, 10)) : "");

function start(opts: { compress?: boolean; title: string; cfg: DocConfig; stamp?: boolean }): { ctx: Ctx; done: () => Promise<Buffer> } {
  const doc = new PDFDocument({ size: "A4", margin: 48, compress: opts.compress ?? true, info: { Title: opts.title, Producer: "Hifi One", Creator: "Hifi One" }, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ctx: Ctx = { doc, lossy: { value: false }, cfg: opts.cfg };
  return {
    ctx,
    done: async () => {
      if (opts.stamp && ctx.cfg.showStamp) stampBlock(ctx);
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor("#777").font("Helvetica");
        const note = ctx.lossy.value ? "Some characters could not be shown in this PDF and appear as ?. See the on-screen version for the full text.  " : "";
        doc.text(`${note}Page ${i + 1} of ${range.count}`, 48, 800, { width: 500, align: "center", lineBreak: false });
      }
      doc.end();
      return finished;
    },
  };
}

// The company stamp, bottom right after the content; on a new page when the last one is full
function stampBlock(ctx: Ctx) {
  const img = asset("stamp.png");
  if (!img) return;
  const { doc } = ctx;
  let y = doc.y + 24;
  if (y + 90 > 785) { doc.addPage(); y = 60; }
  doc.image(img, 430, y, { height: 72 });
  doc.lineWidth(0.6).moveTo(410, y + 80).lineTo(547, y + 80).stroke("#999");
  doc.font("Helvetica").fontSize(7.5).fillColor("#555").text("Company stamp", 410, y + 84, { width: 137, align: "center", lineBreak: false });
  doc.fillColor("#111");
}

function t(ctx: Ctx, s: string | null | undefined) {
  const r = pdfText(s);
  if (r.lossy) ctx.lossy.value = true;
  return r.text;
}

function companyLines(cfg: DocConfig, company: Company): string[] {
  const lines: string[] = [];
  if (cfg.showWebsite && company.website) lines.push(`Website: ${company.website}`);
  if (cfg.showEmail && company.email) lines.push(`Email: ${company.email}`);
  if (cfg.showPhones && company.localUan) lines.push(`UAN (Pak): ${company.localUan}`);
  if (cfg.showPhones && company.globalUan) lines.push(`UAN Global: ${company.globalUan}`);
  if (cfg.showSalesCentre && company.salesCentre) lines.push(`Address: ${company.salesCentre}`);
  if (cfg.showRegisteredOffice && company.registeredOffice) lines.push(`HQ: ${company.registeredOffice}`);
  if (cfg.showRegistrationNo && company.registrationNo) lines.push(`Reg. no. ${company.registrationNo}`);
  if (cfg.showTaxId && company.taxId) lines.push(`Tax ID ${company.taxId}`);
  return lines;
}

const ASSETS = path.join(process.cwd(), "src", "lib", "pdf-assets");
// Images are optional: if one cannot be read the document is still produced, just without it.
function asset(file: string, from: "assets" | "public" = "assets"): Buffer | null {
  try { return readFileSync(from === "assets" ? path.join(ASSETS, file) : path.join(process.cwd(), "public", file)); } catch { return null; }
}

function header(ctx: Ctx, company: Company, title: string, number?: string | null, status?: string) {
  const { doc, cfg } = ctx;
  doc.fillColor(cfg.accent).font("Helvetica-Bold").fontSize(20).text(t(ctx, title), 48, 48);
  doc.fillColor("#333").font("Helvetica").fontSize(10);
  if (number) doc.text(t(ctx, number));
  if (status) doc.fillColor(status === "DRAFT" ? "#b45309" : "#555").text(t(ctx, status === "DRAFT" ? "DRAFT (not issued)" : status.replace(/_/g, " ")));
  const lines = companyLines(cfg, company);
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(11).text(t(ctx, company.legalName), 300, 48, { width: 247, align: "right" });
  doc.font("Helvetica").fontSize(8.5).fillColor("#555");
  for (const l of lines) doc.text(t(ctx, l), 300, doc.y, { width: 247, align: "right" });
  doc.moveDown(0.5);
  doc.y = Math.max(doc.y, 130);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#ddd").stroke();
  doc.moveDown(0.8);
  doc.fillColor("#111");
}

function kv(ctx: Ctx, pairs: [string, string | null | undefined][], x = 48, width = 240) {
  const { doc } = ctx;
  const y0 = doc.y;
  for (const [k, v] of pairs) {
    if (!v) continue;
    doc.font("Helvetica").fontSize(8).fillColor("#777").text(t(ctx, k), x, doc.y, { width });
    doc.font("Helvetica").fontSize(10).fillColor("#111").text(t(ctx, v), x, doc.y, { width });
    doc.moveDown(0.3);
  }
  return doc.y - y0;
}

type Col = { label: string; width: number; align?: "left" | "right" };
function table(ctx: Ctx, cols: Col[], rows: string[][], opts: { totalRow?: string[] } = {}) {
  const { doc, cfg } = ctx;
  const x0 = 48;
  const draw = (cells: string[], bold = false, shade = false) => {
    const y = doc.y;
    const heights = cells.map((c, i) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).heightOfString(t(ctx, c), { width: cols[i].width - 6 }));
    const h = Math.max(...heights, 12) + 6;
    if (y + h > 770) {
      doc.addPage();
    }
    const top = doc.y;
    if (shade) doc.rect(x0, top, cols.reduce((a, c) => a + c.width, 0), h).fill("#f3f4f6").fillColor("#111");
    let x = x0;
    cells.forEach((c, i) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#111").text(t(ctx, c), x + 3, top + 3, { width: cols[i].width - 6, align: cols[i].align ?? "left" });
      x += cols[i].width;
    });
    doc.y = top + h;
  };
  doc.rect(x0, doc.y, cols.reduce((a, c) => a + c.width, 0), 18).fill(cfg.accent);
  let x = x0;
  const hy = doc.y + 5;
  cols.forEach((c) => {
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8.5).text(t(ctx, c.label), x + 3, hy, { width: c.width - 6, align: c.align ?? "left" });
    x += c.width;
  });
  doc.y = hy + 13;
  rows.forEach((r, i) => draw(r, false, i % 2 === 1));
  if (opts.totalRow) draw(opts.totalRow, true, true);
  doc.fillColor("#111");
}

function totals(ctx: Ctx, rows: [string, string, boolean?][]) {
  const { doc } = ctx;
  doc.moveDown(0.6);
  for (const [k, v, bold] of rows) {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).fillColor("#111");
    doc.text(t(ctx, k), 330, y, { width: 110 });
    doc.text(t(ctx, v), 440, y, { width: 107, align: "right" });
    doc.y = y + (bold ? 17 : 14);
  }
}

function bankBlock(ctx: Ctx, bank: Bank | null | undefined, title = "Payment instructions") {
  if (!ctx.cfg.showBank || !bank) return;
  const { doc } = ctx;
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#555").text(t(ctx, title), 48);
  doc.font("Helvetica").fontSize(9.5).fillColor("#111");
  doc.text(t(ctx, [bank.bankName, bank.accountHolder].filter(Boolean).join("  |  ")));
  const rows = [bank.accountNumber && `Account: ${bank.accountNumber}`, bank.iban && `IBAN: ${bank.iban}`, bank.swift && `SWIFT/BIC: ${bank.swift}`, bank.routingCode && `Routing: ${bank.routingCode}`].filter(Boolean) as string[];
  if (rows.length) doc.text(t(ctx, rows.join("   ")));
  if (bank.paymentInstructions) doc.fillColor("#555").text(t(ctx, bank.paymentInstructions));
  doc.fillColor("#111");
}

function footer(ctx: Ctx, company: Company, extra?: string) {
  const { doc, cfg } = ctx;
  const text = [cfg.footerText, company.invoiceFooter, company.legalNotice, extra].filter(Boolean).join("\n");
  if (!text) return;
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(8).fillColor("#666").text(t(ctx, text), 48, doc.y, { width: 499 });
  doc.fillColor("#111");
}

type Build = { compress?: boolean };

// ---- Invoice ----
export type InvoiceDoc = {
  number: string | null; status: string; currency: string; issueDate: Date | null; dueDate: Date | null; notes?: string | null;
  client: { name: string; billingAddress?: string | null; taxId?: string | null; email?: string | null };
  lines: { description: string; quantity: string; unitPrice: string; amount: string }[];
  subtotal: string; taxRate: string; taxAmount: string; total: string; amountPaid: string; creditedAmount: string;
  company: Company; bank: Bank | null; config: DocConfig; templateVersion?: number | null;
};

// ---- Invoice layouts ----
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (d: Date | string | null | undefined) => {
  if (!d) return "-";
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

function invoiceRows(d: InvoiceDoc): { rows: [string, string][]; payable: string } {
  const adjustment = Number(d.amountPaid) + Number(d.creditedAmount);
  const balance = Number(d.total) - adjustment;
  const rows: [string, string][] = [["Subtotal", pdfMoney(d.subtotal, d.currency)]];
  if (Number(d.taxAmount) > 0) rows.push([`Tax (${d.taxRate}%)`, pdfMoney(d.taxAmount, d.currency)], ["Total", pdfMoney(d.total, d.currency)]);
  if (adjustment > 0) rows.push(["Adjustment - previous funds", `- ${pdfMoney(adjustment, d.currency)}`]);
  return { rows, payable: pdfMoney(balance, d.currency) };
}

type InvLine = InvoiceDoc["lines"][number];
function lineParts(ctx: Ctx, l: InvLine, d: InvoiceDoc) {
  const parts = t(ctx, l.description).split("\n");
  const sub = parts.slice(1);
  if (Number(l.quantity) !== 1) sub.push(`${l.quantity} x ${pdfMoney(l.unitPrice, d.currency)}`);
  return { title: parts[0], sub: sub.join("\n") };
}
function measureLine(ctx: Ctx, l: InvLine, d: InvoiceDoc, w: number, size: number): number {
  const { doc } = ctx;
  const p = lineParts(ctx, l, d);
  let h = doc.font("Helvetica-Bold").fontSize(size).heightOfString(p.title, { width: w });
  if (p.sub) h += doc.font("Helvetica").fontSize(size - 1).heightOfString(p.sub, { width: w });
  return h;
}
function drawLine(ctx: Ctx, l: InvLine, d: InvoiceDoc, x: number, y: number, w: number, size: number) {
  const { doc } = ctx;
  const p = lineParts(ctx, l, d);
  doc.font("Helvetica-Bold").fontSize(size).fillColor("#111");
  const h1 = doc.heightOfString(p.title, { width: w });
  doc.text(p.title, x, y, { width: w });
  if (p.sub) doc.font("Helvetica").fontSize(size - 1).fillColor("#555").text(p.sub, x, y + h1, { width: w });
}
function room(ctx: Ctx, y: number, need: number, top = 48): number {
  if (y + need <= 770) return y;
  ctx.doc.addPage();
  return top;
}
function bankPairs(bank: Bank): [string, string][] {
  const r: [string, string | null | undefined][] = [["Bank", bank.bankName], ["Account title", bank.accountHolder], ["Account number", bank.accountNumber], ["IBAN", bank.iban], ["SWIFT/BIC", bank.swift], ["Routing", bank.routingCode]];
  return r.filter((x): x is [string, string] => Boolean(x[1]));
}

// Hifi Signature: the teal and orange wave invoice
function invoiceHifi(ctx: Ctx, d: InvoiceDoc) {
  const { doc, cfg } = ctx;
  const TEAL = "#055579", ORANGE = "#f99d3a", BAND = "#f2f5f8";
  const img = asset("hifi-header.png");
  if (img) doc.image(img, 0, 0, { width: 595.28 });
  else { doc.rect(0, 0, 595.28, 130).fill(TEAL); doc.fillColor("#fff").font("Helvetica-Bold").fontSize(34).text("hifi", 40, 40); }
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(TEAL);
  let y = 116;
  const head = [`DATED: ${longDate(d.issueDate).toUpperCase()}`, `DUE DATE: ${longDate(d.dueDate).toUpperCase()}`, "INVOICE NUMBER", d.number ?? "DRAFT (NOT ISSUED)"];
  for (const h of head) { doc.text(t(ctx, h), 300, y, { width: 247, align: "right", characterSpacing: 1.3, lineBreak: false }); y += 14; }
  let ly = 184;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#222");
  doc.text(t(ctx, d.company.legalName), 38, ly, { width: 300 }); ly = doc.y + 2;
  doc.font("Helvetica").fontSize(8.5).fillColor("#333");
  for (const l of companyLines(cfg, d.company)) { doc.text(t(ctx, l), 38, ly, { width: 300 }); ly = doc.y + 1; }
  y = Math.max(ly + 14, 246);
  doc.rect(32, y, 531, 38).fill(BAND);
  doc.rect(32, y, 3, 38).fill(ORANGE);
  doc.fillColor("#333").font("Helvetica").fontSize(8.5).text("BILL TO", 46, y + 8, { lineBreak: false });
  doc.text("CURRENCY", 330, y + 8, { width: 223, align: "right", lineBreak: false });
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(10).text(t(ctx, d.client.name), 46, y + 21, { width: 380, lineBreak: false });
  doc.text(t(ctx, d.currency), 330, y + 21, { width: 223, align: "right", lineBreak: false });
  y += 38 + 22;
  doc.lineWidth(0.8).rect(32, y, 531, 26).stroke("#111");
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(8.5);
  doc.text("SERVICE DETAILS", 46, y + 9, { characterSpacing: 1.6, lineBreak: false });
  doc.text("TOTAL", 330, y + 9, { width: 223, align: "right", characterSpacing: 1.6, lineBreak: false });
  y += 26 + 16;
  for (const l of d.lines) {
    const h = measureLine(ctx, l, d, 360, 9.5) + 14;
    y = room(ctx, y, h);
    doc.rect(32, y, 531, h).fill(BAND);
    drawLine(ctx, l, d, 40, y + 7, 360, 9.5);
    doc.font("Helvetica").fontSize(9.5).fillColor("#222").text(t(ctx, pdfMoney(l.amount, d.currency)), 410, y + 7, { width: 145, align: "right", lineBreak: false });
    y += h + 4;
  }
  const { rows, payable } = invoiceRows(d);
  y = room(ctx, y + 10, rows.length * 18 + 30);
  for (const [k, v] of rows) {
    const adj = k.startsWith("Adjustment");
    doc.font(adj || k.startsWith("Tax") ? "Helvetica" : "Helvetica-Bold").fontSize(8.5).fillColor("#222");
    doc.text(t(ctx, k.toUpperCase()), 330, y, { width: 150, lineBreak: false });
    doc.text(t(ctx, v), 470, y, { width: 93, align: "right", lineBreak: false });
    y += 18;
  }
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(TEAL);
  doc.text("AMOUNT PAYABLE", 330, y, { width: 150, lineBreak: false });
  doc.text(t(ctx, payable), 450, y, { width: 113, align: "right", lineBreak: false });
  y += 26;
  if (d.notes) { y = room(ctx, y, 40); doc.font("Helvetica").fontSize(8.5).fillColor("#555").text(t(ctx, d.notes), 38, y, { width: 520 }); y = doc.y + 10; }
  y = room(ctx, y + 8, 110);
  const col = (x: number, title: string, pairs: [string, string][], plain: string[]) => {
    let cy = y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text(title, x, cy, { characterSpacing: 0.6, lineBreak: false });
    cy += 18;
    for (const [k, v] of pairs) {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111").text(`${k.toUpperCase()}: `, x, cy, { width: 260, continued: true });
      doc.font("Helvetica").text(t(ctx, v));
      cy = doc.y + 3;
    }
    for (const v of plain) { doc.font("Helvetica").fontSize(8.5).fillColor("#333").text(t(ctx, v), x, cy, { width: 215 }); cy = doc.y + 3; }
    return cy;
  };
  const bank = cfg.showBank && d.bank ? bankPairs(d.bank) : [];
  const y1 = bank.length || (cfg.showBank && d.bank?.paymentInstructions) ? col(38, "TRANSACTION DETAILS:", bank, d.bank?.paymentInstructions ? [d.bank.paymentInstructions] : []) : y;
  const y2 = col(330, "CLIENT DETAILS:", [], [d.client.name.toUpperCase(), d.client.billingAddress ?? "", d.client.taxId ? `Tax ID ${d.client.taxId}` : ""].filter(Boolean));
  doc.y = Math.max(y1, y2);
  footer(ctx, d.company);
  if (cfg.showSignature) {
    let sy = Math.max(doc.y + 56, 705);
    if (sy > 770) { doc.addPage(); sy = 120; }
    doc.lineWidth(0.7).moveTo(38, sy).lineTo(200, sy).stroke("#222").moveTo(390, sy).lineTo(547, sy).stroke("#222");
    const sig = asset("signature.png"), stamp = asset("stamp.png");
    if (sig) doc.image(sig, 70, sy - 46, { height: 44 });
    if (stamp) doc.image(stamp, 430, sy - 56, { height: 60 });
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#222");
    doc.text("Authorised Signature", 38, sy + 4, { lineBreak: false });
    doc.text("Company Stamp", 390, sy + 4, { lineBreak: false });
  }
}

// Modern Indigo: navy to indigo header band
function invoiceModern(ctx: Ctx, d: InvoiceDoc) {
  const { doc, cfg } = ctx;
  const NAVY = "#0f1b4d", INDIGO = "#3b44c4";
  const g = doc.linearGradient(0, 0, 595.28, 0);
  g.stop(0, NAVY).stop(1, INDIGO);
  doc.rect(0, 0, 595.28, 108).fill(g);
  const logo = asset("logo.png", "public");
  if (logo) { doc.roundedRect(40, 28, 52, 52, 10).fill("#ffffff"); doc.image(logo, 45, 33, { width: 42 }); }
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(24).text("INVOICE", 300, 34, { width: 247, align: "right", characterSpacing: 3, lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor("#c7cbff").text(t(ctx, d.number ? `No. ${d.number}` : "DRAFT (not issued)"), 300, 68, { width: 247, align: "right", characterSpacing: 1, lineBreak: false });
  const label = (s: string, x: number, y: number) => doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INDIGO).text(s, x, y, { characterSpacing: 1, lineBreak: false });
  const y0 = 134;
  label("FROM", 48, y0);
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111").text(t(ctx, d.company.legalName), 48, y0 + 13, { width: 170 });
  doc.font("Helvetica").fontSize(8).fillColor("#555");
  for (const l of companyLines(cfg, d.company)) doc.text(t(ctx, l), 48, doc.y + 1, { width: 170 });
  const yFrom = doc.y;
  label("BILLED TO", 235, y0);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text(t(ctx, d.client.name), 235, y0 + 13, { width: 150 });
  doc.font("Helvetica").fontSize(8.5).fillColor("#555");
  if (d.client.billingAddress) doc.text(t(ctx, d.client.billingAddress), 235, doc.y + 1, { width: 150 });
  if (d.client.taxId) doc.text(t(ctx, `Tax ID ${d.client.taxId}`), 235, doc.y + 1, { width: 150 });
  const yTo = doc.y;
  let dy = y0;
  for (const [k, v] of [["ISSUED", longDate(d.issueDate)], ["DUE", longDate(d.dueDate)], ["CURRENCY", d.currency]] as const) {
    label(k, 410, dy);
    doc.font("Helvetica").fontSize(9).fillColor("#111").text(t(ctx, v), 440, dy - 1, { width: 107, align: "right", lineBreak: false });
    dy += 17;
  }
  let y = Math.max(yFrom, yTo, dy) + 26;
  label("SERVICE", 48, y);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INDIGO).text("AMOUNT", 400, y, { width: 147, align: "right", characterSpacing: 1, lineBreak: false });
  y += 13;
  doc.lineWidth(1.5).moveTo(48, y).lineTo(547, y).stroke(NAVY);
  y += 10;
  for (const l of d.lines) {
    const h = measureLine(ctx, l, d, 350, 9.5);
    y = room(ctx, y, h + 14);
    drawLine(ctx, l, d, 48, y, 350, 9.5);
    doc.font("Helvetica").fontSize(9.5).fillColor("#111").text(t(ctx, pdfMoney(l.amount, d.currency)), 400, y, { width: 147, align: "right", lineBreak: false });
    y += h + 8;
    doc.lineWidth(0.5).moveTo(48, y).lineTo(547, y).stroke("#e3e5f5");
    y += 8;
  }
  const { rows, payable } = invoiceRows(d);
  y = room(ctx, y + 10, rows.length * 16 + 50);
  for (const [k, v] of rows) {
    doc.font("Helvetica").fontSize(9).fillColor("#333");
    doc.text(t(ctx, k), 330, y, { width: 130, lineBreak: false });
    doc.text(t(ctx, v), 450, y, { width: 97, align: "right", lineBreak: false });
    y += 16;
  }
  y += 6;
  doc.roundedRect(330, y, 217, 30, 6).fill(NAVY);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);
  doc.text("Amount payable", 342, y + 10, { lineBreak: false });
  doc.text(t(ctx, payable), 430, y + 10, { width: 105, align: "right", lineBreak: false });
  doc.y = y + 40;
  if (d.notes) { doc.font("Helvetica").fontSize(9).fillColor("#555").text(t(ctx, d.notes), 48, doc.y, { width: 499 }); }
  bankBlock(ctx, d.bank);
  footer(ctx, d.company, d.templateVersion ? `Template v${d.templateVersion}` : undefined);
  doc.rect(0, 826, 595.28, 16).fill(INDIGO);
}

// Minimal: white space and thin lines
function invoiceMinimal(ctx: Ctx, d: InvoiceDoc) {
  const { doc, cfg } = ctx;
  const logo = asset("logo.png", "public");
  if (logo) doc.image(logo, 48, 46, { height: 32 });
  doc.font("Helvetica").fontSize(9).fillColor("#777").text(t(ctx, `INVOICE  ${d.number ?? "DRAFT"}`), 300, 54, { width: 247, align: "right", characterSpacing: 3, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#222").text(t(ctx, d.company.legalName), 48, 96, { width: 260 });
  doc.font("Helvetica").fontSize(8).fillColor("#777");
  for (const l of companyLines(cfg, d.company)) doc.text(t(ctx, l), 48, doc.y + 1, { width: 260 });
  const yC = doc.y;
  const small = (s: string, x: number, y: number, align: "left" | "right" = "left") => doc.font("Helvetica").fontSize(8).fillColor("#999").text(s, x, y, { width: 200, align, lineBreak: false });
  const y0 = Math.max(yC + 30, 190);
  small("Billed to", 48, y0);
  doc.font("Helvetica").fontSize(10).fillColor("#111").text(t(ctx, d.client.name), 48, y0 + 12, { width: 260 });
  doc.font("Helvetica").fontSize(8.5).fillColor("#666");
  if (d.client.billingAddress) doc.text(t(ctx, d.client.billingAddress), 48, doc.y + 1, { width: 260 });
  if (d.client.taxId) doc.text(t(ctx, `Tax ID ${d.client.taxId}`), 48, doc.y + 1, { width: 260 });
  const yB = doc.y;
  small("Issued / due", 347, y0, "right");
  doc.font("Helvetica").fontSize(10).fillColor("#111").text(t(ctx, `${longDate(d.issueDate)} / ${longDate(d.dueDate)}`), 247, y0 + 12, { width: 300, align: "right", lineBreak: false });
  small(`Currency ${d.currency}`, 347, y0 + 28, "right");
  let y = Math.max(yB, y0 + 44) + 28;
  doc.lineWidth(0.8).moveTo(48, y).lineTo(547, y).stroke("#222");
  y += 12;
  for (const l of d.lines) {
    const h = measureLine(ctx, l, d, 360, 9.5);
    y = room(ctx, y, h + 20);
    drawLine(ctx, l, d, 48, y, 360, 9.5);
    doc.font("Helvetica").fontSize(9.5).fillColor("#111").text(t(ctx, pdfMoney(l.amount, d.currency)), 410, y, { width: 137, align: "right", lineBreak: false });
    y += h + 10;
    doc.lineWidth(0.4).moveTo(48, y).lineTo(547, y).stroke("#ddd");
    y += 10;
  }
  const { rows, payable } = invoiceRows(d);
  y = room(ctx, y + 4, rows.length * 16 + 50);
  for (const [k, v] of rows) {
    doc.font("Helvetica").fontSize(9).fillColor("#666");
    doc.text(t(ctx, k), 300, y, { width: 160, lineBreak: false });
    doc.text(t(ctx, v), 450, y, { width: 97, align: "right", lineBreak: false });
    y += 16;
  }
  y += 6;
  doc.lineWidth(0.8).moveTo(48, y).lineTo(547, y).stroke("#222");
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#111");
  doc.text("Amount payable", 48, y + 10, { lineBreak: false });
  doc.text(t(ctx, payable), 300, y + 10, { width: 247, align: "right", lineBreak: false });
  doc.y = y + 44;
  if (d.notes) { doc.font("Helvetica").fontSize(9).fillColor("#666").text(t(ctx, d.notes), 48, doc.y, { width: 499 }); }
  bankBlock(ctx, d.bank);
  footer(ctx, d.company, d.templateVersion ? `Template v${d.templateVersion}` : undefined);
}

export async function invoicePdf(d: InvoiceDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Invoice ${d.number ?? "draft"}`, cfg: d.config, stamp: TEMPLATE_KEYS.includes(d.config.template) }); // retired layouts print as they were issued
  const { doc } = ctx;
  if (d.config.template === "hifi-signature") { invoiceHifi(ctx, d); return done(); }
  if (d.config.template === "modern") { invoiceModern(ctx, d); return done(); }
  if (d.config.template === "minimal") { invoiceMinimal(ctx, d); return done(); }
  header(ctx, d.company, "INVOICE", d.number, d.status);
  const y = doc.y;
  kv(ctx, [["Bill to", d.client.name], ["Address", d.client.billingAddress], ["Tax ID", d.client.taxId]], 48, 250);
  const yAfter = doc.y;
  doc.y = y;
  kv(ctx, [["Issue date", fmtDate(d.issueDate) || "-"], ["Due date", fmtDate(d.dueDate) || "-"], ["Currency", d.currency]], 340, 200);
  doc.y = Math.max(doc.y, yAfter) + 8;
  table(ctx, [{ label: "Description", width: 239 }, { label: "Qty", width: 50, align: "right" }, { label: "Unit price", width: 105, align: "right" }, { label: "Amount", width: 105, align: "right" }],
    d.lines.map((l) => [l.description, l.quantity, pdfMoney(l.unitPrice, d.currency), pdfMoney(l.amount, d.currency)]));
  const balance = Number(d.total) - Number(d.amountPaid) - Number(d.creditedAmount);
  totals(ctx, [
    ["Subtotal", pdfMoney(d.subtotal, d.currency)],
    [`Tax (${d.taxRate}%)`, pdfMoney(d.taxAmount, d.currency)],
    ["Total", pdfMoney(d.total, d.currency), true],
    ["Paid", pdfMoney(d.amountPaid, d.currency)],
    ...(Number(d.creditedAmount) > 0 ? ([["Credited", pdfMoney(d.creditedAmount, d.currency)]] as [string, string][]) : []),
    ["Balance due", pdfMoney(balance, d.currency), true],
  ]);
  if (d.notes) { doc.moveDown(0.5); doc.font("Helvetica").fontSize(9).fillColor("#555").text(t(ctx, d.notes), 48, doc.y, { width: 499 }); }
  bankBlock(ctx, d.bank);
  footer(ctx, d.company, d.templateVersion ? `Template v${d.templateVersion}` : undefined);
  return done();
}

// ---- Quotation ----
export type QuoteDoc = {
  number: string; status: string; currency: string; date: Date; validUntil?: string | null; notes?: string | null; terms?: string | null;
  client: { name: string; billingAddress?: string | null };
  lines: { description: string; quantity: string; unitPrice: string; amount: string }[];
  subtotal: string; taxRate: string; taxAmount: string; total: string; company: Company; config: DocConfig;
};
export async function quotePdf(d: QuoteDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Quotation ${d.number}`, cfg: d.config, stamp: true });
  const { doc } = ctx;
  header(ctx, d.company, "QUOTATION", d.number, d.status === "DRAFT" ? "DRAFT" : undefined);
  const y = doc.y;
  kv(ctx, [["Prepared for", d.client.name], ["Address", d.client.billingAddress]], 48, 250);
  const yAfter = doc.y;
  doc.y = y;
  kv(ctx, [["Date", fmtDate(d.date)], ["Valid until", d.validUntil || "-"], ["Currency", d.currency]], 340, 200);
  doc.y = Math.max(doc.y, yAfter) + 8;
  table(ctx, [{ label: "Description", width: 239 }, { label: "Qty", width: 50, align: "right" }, { label: "Unit price", width: 105, align: "right" }, { label: "Amount", width: 105, align: "right" }],
    d.lines.map((l) => [l.description, l.quantity, pdfMoney(l.unitPrice, d.currency), pdfMoney(l.amount, d.currency)]));
  totals(ctx, [["Subtotal", pdfMoney(d.subtotal, d.currency)], [`Tax (${d.taxRate}%)`, pdfMoney(d.taxAmount, d.currency)], ["Total", pdfMoney(d.total, d.currency), true]]);
  if (d.notes) { doc.moveDown(0.5); doc.font("Helvetica").fontSize(9).fillColor("#555").text(t(ctx, d.notes), 48, doc.y, { width: 499 }); }
  if (d.terms) { doc.moveDown(0.5); doc.font("Helvetica-Bold").fontSize(9).fillColor("#333").text("Terms", 48, doc.y); doc.font("Helvetica").fillColor("#555").text(t(ctx, d.terms), 48, doc.y, { width: 499 }); }
  footer(ctx, d.company, "This quotation is not an invoice. Prices are valid until the date shown.");
  return done();
}

// ---- Credit note ----
export type CreditNoteDoc = {
  number: string; date: Date; currency: string; amount: string; taxPortion: string; reason: string; invoiceNumber: string | null; kind?: string;
  client: { name: string; billingAddress?: string | null }; company: Company; config: DocConfig;
};
export async function creditNotePdf(d: CreditNoteDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Credit note ${d.number}`, cfg: d.config, stamp: true });
  header(ctx, d.company, d.kind === "WRITE_OFF" ? "WRITE-OFF NOTICE" : "CREDIT NOTE", d.number);
  kv(ctx, [["Client", d.client.name], ["Address", d.client.billingAddress], ["Date", fmtDate(d.date)], ["Against invoice", d.invoiceNumber], ["Reason", d.reason]]);
  totals(ctx, [["Revenue reversed", pdfMoney(Number(d.amount) - Number(d.taxPortion), d.currency)], ["Tax reversed", pdfMoney(d.taxPortion, d.currency)], ["Total credit", pdfMoney(d.amount, d.currency), true]]);
  footer(ctx, d.company);
  return done();
}

// ---- Receipt ----
export type ReceiptDoc = {
  number: string; date: Date; currency: string; amount: string; unallocated: string; method: string; reference?: string | null; receivedBy?: string | null;
  client: { name: string }; allocations: { invoiceNumber: string | null; amount: string }[]; bankName?: string | null; company: Company; config: DocConfig;
};
export async function receiptPdf(d: ReceiptDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Receipt ${d.number}`, cfg: d.config, stamp: true });
  header(ctx, d.company, "PAYMENT RECEIPT", d.number);
  kv(ctx, [["Received from", d.client.name], ["Date", fmtDate(d.date)], ["Method", d.method.replace(/_/g, " ").toLowerCase()], ["Reference", d.reference], ["Paid into", d.bankName], ["Received by", d.receivedBy]]);
  doc_move(ctx);
  if (d.allocations.length) {
    table(ctx, [{ label: "Applied to invoice", width: 330 }, { label: "Amount", width: 169, align: "right" }], d.allocations.map((a) => [a.invoiceNumber ?? "-", pdfMoney(a.amount, d.currency)]));
  }
  totals(ctx, [...(Number(d.unallocated) > 0 ? ([["Held on account", pdfMoney(d.unallocated, d.currency)]] as [string, string][]) : []), ["Amount received", pdfMoney(d.amount, d.currency), true]]);
  footer(ctx, d.company, "This receipt confirms a recorded payment. It is not a tax invoice.");
  return done();
}
function doc_move(ctx: Ctx) { ctx.doc.moveDown(0.5); }

// ---- Statement ----
export type StatementDoc = {
  client: { name: string; code?: string | null }; asOf: Date; company: Company; config: DocConfig;
  rows: { date: Date; number: string; description: string; debit: string; credit: string; balance: string; currency: string }[];
  advances: { currency: string; amount: string }[];
  // Wording for other parties (a vendor's statement): defaults are the client's
  labels?: { party: string; debit: string; credit: string; balance: string; heading: string };
};
export async function statementPdf(d: StatementDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Statement ${d.client.name}`, cfg: d.config, stamp: true });
  const L = d.labels ?? { party: "Client", debit: "Charges", credit: "Payments", balance: "Balance", heading: "ACCOUNT STATEMENT" };
  header(ctx, d.company, L.heading);
  kv(ctx, [[L.party, `${d.client.name}${d.client.code ? ` (${d.client.code})` : ""}`], ["As of", fmtDate(d.asOf)]]);
  doc_move(ctx);
  const cur = [...new Set(d.rows.map((r) => r.currency))];
  if (cur.length === 0) ctx.doc.font("Helvetica").fontSize(10).text("No transactions yet.", 48);
  for (const c of cur) {
    const rows = d.rows.filter((r) => r.currency === c);
    ctx.doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text(t(ctx, `Currency ${c}`), 48);
    ctx.doc.moveDown(0.2);
    table(ctx, [{ label: "Date", width: 62 }, { label: "Document", width: 78 }, { label: "Description", width: 149 }, { label: L.debit, width: 70, align: "right" }, { label: L.credit, width: 70, align: "right" }, { label: L.balance, width: 70, align: "right" }],
      rows.map((r) => [fmtDate(r.date), r.number, r.description, Number(r.debit) > 0 ? pdfMoney(r.debit, c) : "", Number(r.credit) > 0 ? pdfMoney(r.credit, c) : "", pdfMoney(r.balance, c)]));
    ctx.doc.moveDown(0.8);
  }
  for (const a of d.advances) ctx.doc.font("Helvetica").fontSize(10).text(t(ctx, `Credit held on account: ${pdfMoney(a.amount, a.currency)}`), 48);
  footer(ctx, d.company);
  return done();
}

// ---- Payslip ----
export type PayslipDoc = {
  period: string; currency: string; status: string; employee: { name: string; employeeNo?: string | null; designation?: string | null };
  basic: string; allowance: string; bonus: string; commission?: string; unpaidDeduction: string; unpaidDays: string; workingDays: number; gross: string; taxPercent: string; tax: string; net: string;
  company: Company; config: DocConfig;
};
export async function payslipPdf(d: PayslipDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Payslip ${d.period}`, cfg: d.config, stamp: true });
  header(ctx, d.company, `PAYSLIP ${d.period}`, null, d.status === "DRAFT" ? "DRAFT" : undefined);
  kv(ctx, [["Employee", `${d.employee.name}${d.employee.employeeNo ? ` (${d.employee.employeeNo})` : ""}`], ["Designation", d.employee.designation]]);
  doc_move(ctx);
  const m = (v: string) => pdfMoney(v, d.currency);
  const rows: string[][] = [["Basic salary", m(d.basic)], ["Allowances", m(d.allowance)]];
  if (Number(d.bonus) > 0) rows.push(["Bonus", m(d.bonus)]);
  if (d.commission && Number(d.commission) > 0) rows.push(["Commissions and approved bonuses", m(d.commission)]);
  if (Number(d.unpaidDeduction) > 0) rows.push([`Unpaid leave (${d.unpaidDays} of ${d.workingDays} working days)`, `-${m(d.unpaidDeduction)}`]);
  rows.push(["Gross pay", m(d.gross)], [`Tax withheld (${d.taxPercent}%)`, `-${m(d.tax)}`]);
  table(ctx, [{ label: "Item", width: 349 }, { label: "Amount", width: 150, align: "right" }], rows, { totalRow: ["Net pay", m(d.net)] });
  footer(ctx, d.company, "Confidential. For the named employee only.");
  return done();
}

// ---- Expense voucher ----
export type VoucherDoc = {
  number: string; date: string; status: string; currency: string; amount: string; payee: string; description: string; justification?: string | null; category: string;
  project?: string | null; submittedBy: string; reviewedBy?: string | null; approvedBy?: string | null; paidBy?: string | null; company: Company; config: DocConfig;
};
export async function voucherPdf(d: VoucherDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Expense voucher ${d.number}`, cfg: d.config });
  header(ctx, d.company, "EXPENSE VOUCHER", d.number, d.status);
  kv(ctx, [["Payee", d.payee], ["Date", d.date], ["Category", d.category], ["Project", d.project], ["Description", d.description], ["Business justification", d.justification]], 48, 499);
  totals(ctx, [["Amount", pdfMoney(d.amount, d.currency), true]]);
  ctx.doc.moveDown(1.5);
  const y = ctx.doc.y;
  const sign = (label: string, name: string | null | undefined, x: number) => {
    ctx.doc.moveTo(x, y + 28).lineTo(x + 110, y + 28).strokeColor("#999").stroke();
    ctx.doc.font("Helvetica").fontSize(8).fillColor("#777").text(t(ctx, label), x, y + 31, { width: 110 });
    ctx.doc.fontSize(9).fillColor("#111").text(t(ctx, name ?? ""), x, y + 14, { width: 110 });
  };
  sign("Prepared by", d.submittedBy, 48); sign("Reviewed by", d.reviewedBy, 178); sign("Approved by", d.approvedBy, 308); sign("Paid by", d.paidBy, 438);
  ctx.doc.y = y + 60;
  footer(ctx, d.company);
  return done();
}

// ---- Generic report (any ReportTable: finance, leads, workforce) ----
export type ReportDoc = {
  title: string; subtitle: string; company: Company; config: DocConfig; generatedBy: string;
  sections: { heading: string; columns: { label: string; align?: "left" | "right" }[]; rows: string[][]; totals?: string[] }[]; notes: string[];
};
export async function reportPdf(d: ReportDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: d.title, cfg: d.config });
  header(ctx, d.company, d.title.toUpperCase());
  kv(ctx, [["Period", d.subtitle], ["Prepared by", d.generatedBy], ["Generated", new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"]]);
  doc_move(ctx);
  for (const s of d.sections) {
    ctx.doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text(t(ctx, s.heading), 48);
    ctx.doc.moveDown(0.2);
    const n = s.columns.length;
    const first = n > 1 ? Math.min(180, Math.floor(499 / n) + 40) : 499;
    const rest = n > 1 ? Math.floor((499 - first) / (n - 1)) : 0;
    const cols = s.columns.map((c, i) => ({ label: c.label, align: c.align, width: i === 0 ? first : rest }));
    if (s.rows.length === 0) ctx.doc.font("Helvetica").fontSize(9).fillColor("#555").text("Nothing to show.", 48);
    else table(ctx, cols, s.rows, { totalRow: s.totals });
    ctx.doc.moveDown(0.8);
  }
  for (const note of d.notes) ctx.doc.font("Helvetica").fontSize(8.5).fillColor("#555").text(t(ctx, note), 48, undefined, { width: 499 });
  footer(ctx, d.company);
  return done();
}

// ---- Agreement (the text as sent, plus the signature block once signed) ----
export type AgreementDoc = {
  number: string; title: string; body: string; status: string; company: Company; config: DocConfig; counterparty: string | null;
  sentAt: Date | null; signedAt: Date | null; signerName: string | null; signedIp: string | null; bodyHash: string; signatureImage: string | null;
  declineReason: string | null;
};
export async function agreementPdf(d: AgreementDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: d.title, cfg: d.config, stamp: true });
  const { doc } = ctx;
  header(ctx, d.company, "AGREEMENT", d.number, d.status);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#111").text(t(ctx, d.title), 48);
  doc.moveDown(0.3);
  kv(ctx, [["With", d.counterparty], ["Sent", d.sentAt ? fmtDate(d.sentAt) : null]]);
  doc_move(ctx);
  doc.font("Helvetica").fontSize(10).fillColor("#111").text(t(ctx, d.body), 48, doc.y, { width: 499, align: "left" });
  doc.moveDown(1.2);
  if (doc.y > 640) doc.addPage();
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#ddd").stroke();
  doc.moveDown(0.6);
  if (d.status === "SIGNED" && d.signedAt) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text("Electronic signature", 48);
    doc.moveDown(0.3);
    const m = d.signatureImage?.match(/^data:image\/png;base64,(.+)$/);
    if (m) { try { doc.image(Buffer.from(m[1], "base64"), 48, doc.y, { fit: [220, 70] }); doc.moveDown(5); } catch { /* an unreadable drawing is skipped; the typed name below still stands */ } }
    kv(ctx, [["Signed by (typed name)", d.signerName], ["Signed at", d.signedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC"], ["Network address", d.signedIp], ["Fingerprint of the signed text (SHA-256)", d.bodyHash]], 48, 499);
    doc.font("Helvetica").fontSize(8).fillColor("#666").text("This is a simple electronic signature recorded by Hifi One. It shows who opened the one-time link and the exact text they agreed to.", 48, doc.y, { width: 499 });
  } else if (d.status === "DECLINED") {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#b91c1c").text("Declined by the signer", 48);
    if (d.declineReason) doc.font("Helvetica").fontSize(10).fillColor("#111").text(t(ctx, d.declineReason), 48, undefined, { width: 499 });
  } else {
    doc.font("Helvetica").fontSize(10).fillColor("#b45309").text(d.status === "VOID" ? "This agreement was voided." : "Not signed yet.", 48);
  }
  footer(ctx, d.company);
  return done();
}
