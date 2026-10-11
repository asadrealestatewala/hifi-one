// Server-side PDF documents. Builders take plain data (so they are easy to test) and return the file as a Buffer.
// Standard PDF fonts only cover Western European characters. Anything else (for example Urdu or Arabic script) is shown as "?"
// and the document says so, rather than printing wrong letters silently. Full right-to-left support needs a different renderer.
import PDFDocument from "pdfkit";

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
};

export const DEFAULT_DOC_CONFIG: DocConfig = {
  showRegisteredOffice: true, showSalesCentre: true, showPhones: true, showEmail: true, showWebsite: true, showRegistrationNo: true, showTaxId: true,
  showBank: true, footerText: "", accent: "#e11d1d",
};

export function mergeConfig(c: Partial<DocConfig> | null | undefined): DocConfig {
  const m: DocConfig = { ...DEFAULT_DOC_CONFIG };
  for (const k of Object.keys(DEFAULT_DOC_CONFIG) as (keyof DocConfig)[]) {
    const v = c?.[k];
    if (v !== undefined && typeof v === typeof DEFAULT_DOC_CONFIG[k]) (m as Record<string, unknown>)[k] = v;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(m.accent)) m.accent = DEFAULT_DOC_CONFIG.accent;
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

function start(opts: { compress?: boolean; title: string; cfg: DocConfig }): { ctx: Ctx; done: () => Promise<Buffer> } {
  const doc = new PDFDocument({ size: "A4", margin: 48, compress: opts.compress ?? true, info: { Title: opts.title, Producer: "Hifi One", Creator: "Hifi One" }, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ctx: Ctx = { doc, lossy: { value: false }, cfg: opts.cfg };
  return {
    ctx,
    done: async () => {
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

function t(ctx: Ctx, s: string | null | undefined) {
  const r = pdfText(s);
  if (r.lossy) ctx.lossy.value = true;
  return r.text;
}

function header(ctx: Ctx, company: Company, title: string, number?: string | null, status?: string) {
  const { doc, cfg } = ctx;
  doc.fillColor(cfg.accent).font("Helvetica-Bold").fontSize(20).text(t(ctx, title), 48, 48);
  doc.fillColor("#333").font("Helvetica").fontSize(10);
  if (number) doc.text(t(ctx, number));
  if (status) doc.fillColor(status === "DRAFT" ? "#b45309" : "#555").text(t(ctx, status === "DRAFT" ? "DRAFT (not issued)" : status.replace(/_/g, " ")));
  const lines: string[] = [];
  if (cfg.showRegisteredOffice && company.registeredOffice) lines.push(company.registeredOffice);
  if (cfg.showSalesCentre && company.salesCentre) lines.push(`Sales centre: ${company.salesCentre}`);
  if (cfg.showPhones) {
    const ph = [company.globalUan, company.localUan].filter(Boolean).join("  |  ");
    if (ph) lines.push(ph);
  }
  if (cfg.showEmail && company.email) lines.push(company.email);
  if (cfg.showWebsite && company.website) lines.push(company.website);
  if (cfg.showRegistrationNo && company.registrationNo) lines.push(`Reg. no. ${company.registrationNo}`);
  if (cfg.showTaxId && company.taxId) lines.push(`Tax ID ${company.taxId}`);
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

export async function invoicePdf(d: InvoiceDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Invoice ${d.number ?? "draft"}`, cfg: d.config });
  const { doc } = ctx;
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
  const { ctx, done } = start({ ...b, title: `Quotation ${d.number}`, cfg: d.config });
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
  number: string; date: Date; currency: string; amount: string; taxPortion: string; reason: string; invoiceNumber: string | null;
  client: { name: string; billingAddress?: string | null }; company: Company; config: DocConfig;
};
export async function creditNotePdf(d: CreditNoteDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Credit note ${d.number}`, cfg: d.config });
  header(ctx, d.company, "CREDIT NOTE", d.number);
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
  const { ctx, done } = start({ ...b, title: `Receipt ${d.number}`, cfg: d.config });
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
};
export async function statementPdf(d: StatementDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Statement ${d.client.name}`, cfg: d.config });
  header(ctx, d.company, "ACCOUNT STATEMENT");
  kv(ctx, [["Client", `${d.client.name}${d.client.code ? ` (${d.client.code})` : ""}`], ["As of", fmtDate(d.asOf)]]);
  doc_move(ctx);
  const cur = [...new Set(d.rows.map((r) => r.currency))];
  if (cur.length === 0) ctx.doc.font("Helvetica").fontSize(10).text("No transactions yet.", 48);
  for (const c of cur) {
    const rows = d.rows.filter((r) => r.currency === c);
    ctx.doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text(t(ctx, `Currency ${c}`), 48);
    ctx.doc.moveDown(0.2);
    table(ctx, [{ label: "Date", width: 62 }, { label: "Document", width: 78 }, { label: "Description", width: 149 }, { label: "Charges", width: 70, align: "right" }, { label: "Payments", width: 70, align: "right" }, { label: "Balance", width: 70, align: "right" }],
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
  basic: string; allowance: string; bonus: string; unpaidDeduction: string; unpaidDays: string; workingDays: number; gross: string; taxPercent: string; tax: string; net: string;
  company: Company; config: DocConfig;
};
export async function payslipPdf(d: PayslipDoc, b: Build = {}) {
  const { ctx, done } = start({ ...b, title: `Payslip ${d.period}`, cfg: d.config });
  header(ctx, d.company, `PAYSLIP ${d.period}`, null, d.status === "DRAFT" ? "DRAFT" : undefined);
  kv(ctx, [["Employee", `${d.employee.name}${d.employee.employeeNo ? ` (${d.employee.employeeNo})` : ""}`], ["Designation", d.employee.designation]]);
  doc_move(ctx);
  const m = (v: string) => pdfMoney(v, d.currency);
  const rows: string[][] = [["Basic salary", m(d.basic)], ["Allowances", m(d.allowance)]];
  if (Number(d.bonus) > 0) rows.push(["Bonus", m(d.bonus)]);
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
