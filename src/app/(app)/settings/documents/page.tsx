import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_DOC_CONFIG, mergeConfig, type DocConfig } from "@/lib/pdf";
import { DOC_TYPES, getDocConfig, type DocType } from "@/lib/pdf-data";

export const dynamic = "force-dynamic";

const TITLES: Record<DocType, string> = { QUOTE: "Quotations", INVOICE: "Invoices", RECEIPT: "Receipts", CREDIT_NOTE: "Credit notes", STATEMENT: "Customer statements", PAYSLIP: "Payslips", VOUCHER: "Expense vouchers" };
const TOGGLES: [keyof DocConfig, string][] = [
  ["showRegisteredOffice", "Registered office"], ["showSalesCentre", "Sales centre"], ["showPhones", "Phone numbers (UANs)"], ["showEmail", "Company email"],
  ["showWebsite", "Website"], ["showRegistrationNo", "Registration number"], ["showTaxId", "Tax ID"], ["showBank", "Bank payment instructions"],
];

async function save(formData: FormData) {
  "use server";
  const user = await requirePermission("settings.company.edit");
  const docType = String(formData.get("docType")) as DocType;
  if (!DOC_TYPES.includes(docType)) redirect("/settings/documents");
  const op = String(formData.get("op"));
  const before = await db.documentSetting.findUnique({ where: { organizationId_docType: { organizationId: user.organizationId, docType } } });
  if (op === "reset") {
    if (before) await db.documentSetting.delete({ where: { id: before.id } });
  } else {
    const raw: Record<string, unknown> = { footerText: String(formData.get("footerText") ?? "").slice(0, 500), accent: String(formData.get("accent") ?? "") };
    for (const [k] of TOGGLES) raw[k] = formData.get(k) === "on";
    const config = mergeConfig(raw as Partial<DocConfig>);
    await db.documentSetting.upsert({
      where: { organizationId_docType: { organizationId: user.organizationId, docType } },
      update: { config: config as never, version: { increment: 1 }, updatedById: user.id },
      create: { organizationId: user.organizationId, docType, config: config as never, version: 1, updatedById: user.id },
    });
  }
  const after = await db.documentSetting.findUnique({ where: { organizationId_docType: { organizationId: user.organizationId, docType } } });
  await db.settingChange.create({ data: { organizationId: user.organizationId, section: `document:${docType}`, actorId: user.id, before: before?.config as never, after: (after?.config ?? { reset: true }) as never } });
  await audit(user, { action: `document_setting.${op === "reset" ? "reset" : "update"}`, entity: "DocumentSetting", entityId: after?.id ?? before?.id, after: { docType, version: after?.version ?? 0 } });
  redirect(`/settings/documents?saved=${docType}`);
}

export default async function DocumentSettings({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const user = await requirePermission("settings.company.view");
  const { saved } = await searchParams;
  const canEdit = user.permissions.has("settings.company.edit");
  const configs = await Promise.all(DOC_TYPES.map(async (t) => [t, await getDocConfig(db, user.organizationId, t)] as const));
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Document templates</h1>
      <p className="text-sm text-muted">
        Choose which company details appear on each kind of PDF and add footer text. Company name, addresses, phone numbers and bank details come from Company Settings and Bank Accounts.
        <strong> Invoices keep the details and template they were issued with</strong>, so changing a template or the company profile never alters an invoice already sent. Receipts, statements, payslips and vouchers use the current template and company profile.
      </p>
      {saved && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">Saved {TITLES[saved as DocType] ?? saved}.</p>}
      {configs.map(([type, { config, version }]) => (
        <div key={type} className="card space-y-3">
        <form action={save} className="space-y-3">
          <input type="hidden" name="docType" value={type} />
          <input type="hidden" name="op" value="save" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{TITLES[type]} <span className="text-xs font-normal text-muted">{version === 0 ? "default template" : `version ${version}`}</span></h2>
            <a className="btn-ghost" href={`/settings/documents/preview?type=${type}`} target="_blank" rel="noopener">Preview PDF</a>
          </div>
          <div className="grid gap-1 sm:grid-cols-2 text-sm">
            {TOGGLES.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" name={k} defaultChecked={Boolean(config[k])} disabled={!canEdit} /> {label}</label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div><label className="label" htmlFor={`f-${type}`}>Footer text</label><input id={`f-${type}`} name="footerText" defaultValue={config.footerText} disabled={!canEdit} maxLength={500} className="input" /></div>
            <div><label className="label" htmlFor={`a-${type}`}>Accent colour</label><input id={`a-${type}`} name="accent" type="color" defaultValue={config.accent || DEFAULT_DOC_CONFIG.accent} disabled={!canEdit} className="input !p-1 h-10" /></div>
          </div>
          {canEdit && <button className="btn">Save</button>}
        </form>
        {canEdit && version > 0 && (
          <form action={save}><input type="hidden" name="docType" value={type} /><input type="hidden" name="op" value="reset" /><button className="btn-ghost">Reset to default</button></form>
        )}
        </div>
      ))}
    </div>
  );
}
