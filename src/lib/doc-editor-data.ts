// Everything the invoice and proposal editors and their live preview need, loaded on the server and scoped to the organization.
import { db } from "@/lib/db";
import { companyLines, INVOICE_TEMPLATES, quoteLayout } from "@/lib/pdf";
import { companyFrom, getDocConfig } from "@/lib/pdf-data";

export type EditorClient = { id: string; name: string; currency: string; billingAddress: string | null; taxId: string | null; paymentTermsDays: number };
export type EditorData = {
  clients: EditorClient[];
  taxPresets: { name: string; rate: string }[];
  templates: { key: string; label: string }[];
  defaultTemplate: string;
  company: { name: string; lines: string[] };
  banks: Record<string, [string, string][]>; // currency → labelled bank details shown on the invoice
  bankInstructions: Record<string, string>;
  footer: string;
  stamp: boolean;
};

export async function loadEditorData(organizationId: string, docType: "INVOICE" | "QUOTE" = "INVOICE"): Promise<EditorData> {
  const [clients, rates, profile, banks, { config }] = await Promise.all([
    db.client.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true, billingAddress: true, taxId: true, paymentTermsDays: true } }),
    db.taxRate.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" } }),
    db.companyProfile.findFirst({ where: { organizationId, isDefault: true } }),
    db.bankAccount.findMany({ where: { organizationId, active: true, isDefault: true } }),
    getDocConfig(db, organizationId, docType),
  ]);
  const company = companyFrom(profile as unknown as Record<string, unknown>);
  const bankMap: EditorData["banks"] = {};
  const instructions: EditorData["bankInstructions"] = {};
  // Same rule as issuing: the default active account in the invoice currency is printed on the invoice
  if (docType === "INVOICE" && config.showBank) for (const b of banks) {
    const rows: [string, string | null][] = [["Bank", b.bankName], ["Account title", b.accountHolder], ["Account", b.accountNumber], ["IBAN", b.iban], ["SWIFT/BIC", b.swift]];
    bankMap[b.currency] = rows.filter((r): r is [string, string] => Boolean(r[1]));
    if (b.paymentInstructions) instructions[b.currency] = b.paymentInstructions;
  }
  return {
    clients,
    taxPresets: rates.map((r) => ({ name: r.name, rate: r.ratePercent.toString() })),
    templates: INVOICE_TEMPLATES.map((t) => ({ key: t.key, label: t.label })),
    defaultTemplate: docType === "QUOTE" ? quoteLayout(null, config) : config.template,
    company: { name: company.legalName, lines: companyLines(config, company) },
    banks: bankMap,
    bankInstructions: instructions,
    footer: [config.footerText, company.invoiceFooter, company.legalNotice].filter(Boolean).join("\n"),
    stamp: config.showStamp,
  };
}
