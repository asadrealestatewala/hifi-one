import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

const optional = z.string().trim().max(500).optional().transform((v) => (v ? v : null));

const schema = z.object({
  legalName: z.string().trim().min(2, "Legal name is required").max(200),
  tradingName: optional,
  website: optional,
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => (v ? v : null)),
  description: optional,
  globalUan: optional,
  localUan: optional,
  registeredOffice: optional,
  salesCentre: optional,
  registrationNo: optional,
  taxId: optional,
  legalNotice: optional,
  invoiceFooter: optional,
  defaultCurrency: z.enum(["PKR", "USD", "AED", "GBP"]),
  timezone: z.string().trim().min(1).max(60),
});

async function save(formData: FormData) {
  "use server";
  const user = await requirePermission("settings.company.edit");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const before = await db.companyProfile.findFirstOrThrow({
    where: { organizationId: user.organizationId, isDefault: true },
  });
  const after = await db.companyProfile.update({
    where: { id: before.id },
    data: { ...parsed.data, version: { increment: 1 } },
  });
  await db.settingChange.create({
    data: { organizationId: user.organizationId, section: "company_profile", actorId: user.id, before, after },
  });
  await audit(user, { action: "company_profile.update", entity: "CompanyProfile", entityId: before.id, before, after });
  revalidatePath("/settings/company");
}

const FIELDS: { name: keyof z.infer<typeof schema>; label: string; wide?: boolean }[] = [
  { name: "legalName", label: "Legal name" },
  { name: "tradingName", label: "Trading name" },
  { name: "website", label: "Website" },
  { name: "email", label: "Company email" },
  { name: "globalUan", label: "Global UAN" },
  { name: "localUan", label: "Local UAN" },
  { name: "registeredOffice", label: "Registered office (USA)", wide: true },
  { name: "salesCentre", label: "Sales centre (Pakistan)", wide: true },
  { name: "registrationNo", label: "Registration number" },
  { name: "taxId", label: "Tax ID" },
  { name: "legalNotice", label: "Legal notice", wide: true },
  { name: "invoiceFooter", label: "Invoice footer text", wide: true },
  { name: "description", label: "Company description", wide: true },
];

export default async function CompanySettings() {
  const user = await requirePermission("settings.company.view");
  const canEdit = user.permissions.has("settings.company.edit");
  const p = await db.companyProfile.findFirstOrThrow({ where: { organizationId: user.organizationId, isDefault: true } });
  const history = await db.settingChange.findMany({
    where: { organizationId: user.organizationId, section: "company_profile" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Company Settings</h1>
        <p className="text-sm text-muted">
          Version {p.version}, last updated {p.updatedAt.toLocaleString()}. New documents use these details; documents
          already issued keep their own snapshot.
        </p>
      </div>
      <form action={save} className="card grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.name} className={f.wide ? "sm:col-span-2" : ""}>
            <label className="label" htmlFor={f.name}>{f.label}</label>
            <input
              id={f.name}
              name={f.name}
              defaultValue={(p[f.name as keyof typeof p] as string | null) ?? ""}
              disabled={!canEdit}
              className="input"
            />
          </div>
        ))}
        <div>
          <label className="label" htmlFor="defaultCurrency">Functional currency</label>
          <select id="defaultCurrency" name="defaultCurrency" defaultValue={p.defaultCurrency} disabled={!canEdit} className="input">
            {["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="timezone">Default timezone</label>
          <input id="timezone" name="timezone" defaultValue={p.timezone} disabled={!canEdit} className="input" />
        </div>
        {canEdit && (
          <div className="sm:col-span-2">
            <button className="btn">Save changes</button>
          </div>
        )}
      </form>
      <section className="card">
        <h2 className="font-semibold mb-2">Recent changes</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">No changes recorded yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {history.map((h) => (
              <li key={h.id}>{h.createdAt.toLocaleString()}: company profile updated</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
