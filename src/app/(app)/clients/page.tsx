import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Avatar, Chips, Empty, NewButton, PageHeader, Pager, PanelForm, SearchBox, SortTh, Stat, StatusBadge } from "@/components/ui";
import { paging } from "@/lib/paging";
import { orderFor, parseSort } from "@/lib/sort";
import Drawer from "@/components/ui/Drawer";
import SavedViews from "@/components/SavedViews";
import { loadViews } from "@/lib/saved-views";

export const dynamic = "force-dynamic";

const opt = z.string().trim().max(300).optional().transform((v) => (v ? v : null));
const schema = z.object({
  name: z.string().trim().min(2, "Client name is required").max(200),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)),
  phone: opt,
  billingAddress: opt,
  country: opt,
  taxId: opt,
  currency: z.enum(["PKR", "USD", "AED", "GBP"]),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
});

async function createClient(formData: FormData) {
  "use server";
  const user = await requirePermission("clients.edit");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/clients?new=1&error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  const dup = await db.client.findFirst({
    where: { organizationId: user.organizationId, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (dup) redirect(`/clients?new=1&error=${encodeURIComponent("A client with this name already exists.")}`);
  const seq = await db.numberSequence.upsert({
    where: { organizationId_key: { organizationId: user.organizationId, key: "CLIENT" } },
    create: { organizationId: user.organizationId, key: "CLIENT", next: 2 },
    update: { next: { increment: 1 } },
  });
  const client = await db.client.create({
    data: { ...parsed.data, organizationId: user.organizationId, code: `C-${String(seq.next - 1).padStart(4, "0")}` },
  });
  await audit(user, { action: "client.create", entity: "Client", entityId: client.id, after: { name: client.name, code: client.code } });
  redirect(`/clients/${client.id}`);
}

type SP = { error?: string; q?: string; show?: string; new?: string; page?: string; sort?: string; dir?: string; viewError?: string };
const SORTS = { name: { field: "name" }, country: { field: "country", nullable: true }, currency: { field: "currency" } };

export default async function Clients({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("clients.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canEdit = user.permissions.has("clients.edit");
  const show = sp.show === "inactive" ? "inactive" : sp.show === "all" ? "all" : "active";
  const q = sp.q?.trim();
  const pg = paging(sp.page);
  const views = await loadViews(db, user.id, "clients");
  const sort = parseSort(sp.sort, sp.dir, Object.keys(SORTS), { key: "name", dir: "asc" });
  const where = { organizationId: org, ...(show === "all" ? {} : { active: show === "active" }), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }, { code: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const [clients, matched, currencies, active, inactive] = await Promise.all([
    db.client.findMany({ where, orderBy: orderFor(sort, SORTS), skip: pg.skip, take: pg.take }),
    db.client.count({ where }),
    db.client.groupBy({ by: ["currency"], where: { organizationId: org, active: true }, orderBy: { currency: "asc" } }),
    db.client.count({ where: { organizationId: org, active: true } }),
    db.client.count({ where: { organizationId: org, active: false } }),
  ]);
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ show: show === "active" ? undefined : show, q, sort: sp.sort && sort.key === sp.sort ? sort.key : undefined, dir: sp.sort && sort.key === sp.sort ? sort.dir : undefined, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/clients${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader title="Client accounts" subtitle="Who you bill, in which currency and on what terms." actions={canEdit ? <NewButton href={href({ new: "1" })}>Add client</NewButton> : undefined} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Active clients" value={active} />
        <Stat label="Inactive" value={inactive} />
        <Stat label="Billing currencies" value={currencies.map((c) => c.currency).join(" · ") || "None"} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search name, email or code" hidden={{ show: show === "active" ? undefined : show }} />
        <Chips current={show} items={[{ key: "active", label: "Active", count: active, href: href({ show: undefined }) }, { key: "inactive", label: "Inactive", count: inactive, href: href({ show: "inactive" }) }, { key: "all", label: "All", count: active + inactive, href: href({ show: "all" }) }]} />
      </div>
      <SavedViews list="clients" views={views} current={{ q, show: show === "active" ? undefined : show, sort: sp.sort && sort.key === sp.sort ? sort.key : undefined, dir: sp.sort && sort.key === sp.sort ? sort.dir : undefined }} error={sp.viewError} />
      {clients.length === 0 ? <Empty title={q ? "No clients match" : "No clients yet"}>{canEdit ? "Add your first client, or convert a won lead." : "Clients will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><SortTh label="Client" field="name" sort={sort} hrefFor={href} className="px-4 py-2.5" /><th className="pr-4">Email</th><SortTh label="Country" field="country" sort={sort} hrefFor={href} /><SortTh label="Currency" field="currency" sort={sort} hrefFor={href} /><th className="pr-4">Terms</th><th className="pr-4">Status</th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-2.5"><Link href={`/clients/${c.id}`} className="flex items-center gap-3"><Avatar name={c.name} /><span><span className="block font-medium hover:underline">{c.name}</span><span className="text-xs text-muted">{c.code}</span></span></Link></td>
                  <td className="pr-4 text-muted">{c.email}</td>
                  <td className="pr-4 text-muted">{c.country}</td>
                  <td className="pr-4">{c.currency}</td>
                  <td className="pr-4 text-muted">{c.paymentTermsDays} days</td>
                  <td className="pr-4"><StatusBadge status={c.active ? "ACTIVE" : "ENDED"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
        </div>
      )}
      {canEdit && sp.new && (
        <Drawer title="Add client" closeTo={href({ new: undefined })}>
          <PanelForm action={createClient} closeTo={href({ new: undefined })} submit="Add client" error={sp.error} hint="You can add contacts and a portal login afterwards.">
            <div className="grid gap-3 sm:grid-cols-2">
              {[["name", "Client name", true], ["email", "Email", false], ["phone", "Phone", false], ["country", "Country", false], ["taxId", "Tax ID", false]].map(([n, l, r]) => (
                <div key={String(n)} className={n === "name" ? "sm:col-span-2" : ""}>
                  <label className="label" htmlFor={String(n)}>{String(l)}</label>
                  <input id={String(n)} name={String(n)} required={Boolean(r)} className="input" />
                </div>
              ))}
              <div>
                <label className="label" htmlFor="currency">Billing currency</label>
                <select id="currency" name="currency" className="input" defaultValue="USD">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select>
              </div>
              <div>
                <label className="label" htmlFor="paymentTermsDays">Payment terms (days)</label>
                <input id="paymentTermsDays" name="paymentTermsDays" type="number" defaultValue={14} min={0} max={365} className="input" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="billingAddress">Billing address</label>
                <textarea id="billingAddress" name="billingAddress" rows={2} className="input" />
              </div>
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
