import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { AGENT_KINDS, AGENT_KIND_LABEL, DEFAULT_DAILY_TARGET, listProducts, salesTeam } from "@/lib/field-visits";
import { Badge, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { saveAgentAction, saveProductAction } from "./actions";

export const dynamic = "force-dynamic";

// Field sales setup (decision 71): the products the teams sell, and who works which product from the office or in the field.
// Visit capture itself is the field agent's phone screen (phase 2); visit reports and demo bookings follow (phases 3 and 4).
export default async function FieldTeam({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; edit?: string }> }) {
  const user = await requirePermission("field.review");
  const sp = await searchParams;
  const [products, team, counts] = await Promise.all([
    listProducts(db, user.organizationId),
    salesTeam(db, user.organizationId),
    db.prospect.groupBy({ by: ["productId"], where: { organizationId: user.organizationId, status: { not: "DISMISSED" } }, _count: { _all: true } }),
  ]);
  const prospectCount = new Map(counts.map((c) => [c.productId, c._count._all]));
  const editing = sp.edit ? products.find((p) => p.id === sp.edit) ?? null : null;
  const productName = new Map(products.map((p) => [p.id, p.name]));

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Field sales team" subtitle="Each product has office agents who call and field agents who visit businesses. A prospect belongs to one product, and the same business can be a prospect for another product, but never twice for the same one." actions={<Link className="btn-ghost" href="/leads/prospector">Back to Prospector</Link>} />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <section className="space-y-3" aria-labelledby="products-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="products-h" className="font-semibold">Products</h2><span className="text-xs text-muted">{products.length} product{products.length === 1 ? "" : "s"}</span></div>
        {products.length > 0 && <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">Product</th><th className="pr-4">A prospect is a</th><th className="pr-4">Daily visit target</th><th className="pr-4">Prospects</th><th className="pr-4">Status</th><th className="pr-4"></th></tr></thead>
          <tbody>{products.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="py-2 pl-4 pr-4"><p className="font-medium">{p.name}</p><p className="text-xs text-muted">{p.code}{p.website ? ` · ${p.website.replace(/^https?:\/\//, "")}` : ""}</p></td>
              <td className="pr-4">{p.businessLabel}</td>
              <td className="pr-4">{p.dailyVisitTarget} a day</td>
              <td className="pr-4">{prospectCount.get(p.id) ?? 0}</td>
              <td className="pr-4">{p.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">off</Badge>}</td>
              <td className="py-2 pr-4 text-right"><Link className="text-primary hover:underline" href={`/leads/prospector/field-team?edit=${p.id}`}>Edit</Link></td>
            </tr>
          ))}</tbody>
        </table></div>}
        {products.length === 0 && <p className="text-sm text-muted">No products yet. Add the first one below.</p>}

        <form action={saveProductAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3" key={editing?.id ?? "new"}>
          <h3 className="font-medium sm:col-span-2 lg:col-span-3">{editing ? `Edit ${editing.name}` : "Add a product"}</h3>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div><label className="label" htmlFor="p-name">Name</label><input id="p-name" name="name" className="input" required maxLength={80} defaultValue={editing?.name ?? ""} placeholder="Pharmivo" /></div>
          <div><label className="label" htmlFor="p-code">Short code</label><input id="p-code" name="code" className="input" maxLength={24} defaultValue={editing?.code ?? ""} placeholder="PHARMIVO" /><p className="mt-1 text-xs text-muted">Letters and digits. Used in lead tags.</p></div>
          <div><label className="label" htmlFor="p-label">A prospect is a</label><input id="p-label" name="businessLabel" className="input" required maxLength={60} defaultValue={editing?.businessLabel ?? ""} placeholder="Pharmacy" /></div>
          <div><label className="label" htmlFor="p-web">Website</label><input id="p-web" name="website" className="input" type="url" maxLength={200} defaultValue={editing?.website ?? ""} placeholder="https://" /></div>
          <div><label className="label" htmlFor="p-target">Daily visit target (field agents)</label><input id="p-target" name="dailyVisitTarget" className="input" type="number" min={0} max={500} defaultValue={editing?.dailyVisitTarget ?? DEFAULT_DAILY_TARGET} /></div>
          <div><label className="label" htmlFor="p-sort">Order</label><input id="p-sort" name="sortOrder" className="input" type="number" min={0} max={999} defaultValue={editing?.sortOrder ?? products.length} /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3"><input type="checkbox" name="active" defaultChecked={editing ? editing.active : true} /> Active (agents can be put on it and log visits)</label>
          <div className="flex gap-3 sm:col-span-2 lg:col-span-3"><SubmitButton pendingText="Saving…">{editing ? "Save changes" : "Add product"}</SubmitButton>{editing && <Link className="btn-ghost" href="/leads/prospector/field-team">Cancel</Link>}</div>
        </form>
      </section>

      <section className="space-y-3" aria-labelledby="team-h">
        <div><h2 id="team-h" className="font-semibold">Who works which product</h2><p className="text-sm text-muted">Everyone who can add prospects. Field agents log visits from their phone; office agents add prospects from calls. Leave the target empty to use the product&apos;s.</p></div>
        {team.length === 0 && <p className="card text-sm text-muted">Nobody has the permission to add prospects yet. Give the Sales Agent or Sales Manager role in Staff Directory first.</p>}
        <ul className="space-y-3">{team.map((m) => (
          <li key={m.id}>
            <form action={saveAgentAction} className="card grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <input type="hidden" name="userId" value={m.id} />
              <div className="sm:col-span-2"><p className="font-medium">{m.name}</p><p className="text-xs text-muted">{m.productId ? `${productName.get(m.productId) ?? "Product removed"} · ${AGENT_KIND_LABEL[m.kind]}` : "Not on a product yet"}</p></div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><label className="label" htmlFor={`prod-${m.id}`}>Product</label><select id={`prod-${m.id}`} name="productId" className="input" defaultValue={m.productId ?? ""}><option value="">No product</option>{products.filter((p) => p.active || p.id === m.productId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div><label className="label" htmlFor={`kind-${m.id}`}>Works</label><select id={`kind-${m.id}`} name="kind" className="input" defaultValue={m.kind}>{AGENT_KINDS.map((k) => <option key={k} value={k}>{k === "FIELD" ? "Field (visits businesses)" : "Office (cold calling)"}</option>)}</select></div>
                <div><label className="label" htmlFor={`target-${m.id}`}>Own daily target</label><input id={`target-${m.id}`} name="dailyVisitTarget" className="input" type="number" min={0} max={500} defaultValue={m.dailyVisitTarget ?? ""} placeholder={`Product's (${m.productId ? products.find((p) => p.id === m.productId)?.dailyVisitTarget ?? DEFAULT_DAILY_TARGET : DEFAULT_DAILY_TARGET})`} /></div>
              </div>
              <div><SubmitButton pendingText="Saving…">Save</SubmitButton></div>
            </form>
          </li>
        ))}</ul>
      </section>
    </div>
  );
}
