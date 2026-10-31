import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { CatalogError, INTERVALS, createCategory, createPlan } from "@/lib/catalog";
import { db } from "@/lib/db";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

const priceSchema = z.object({
  planId: z.string().min(1),
  currency: z.enum(CURRENCIES),
  amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a positive amount"),
});

async function setPrice(formData: FormData) {
  "use server";
  const user = await requirePermission("catalog.edit");
  const parsed = priceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { planId, currency, amount } = parsed.data;
  const plan = await db.servicePlan.findFirstOrThrow({ where: { id: planId, organizationId: user.organizationId } });
  const before = await db.planPrice.findUnique({ where: { planId_currency: { planId, currency } } });
  await db.planPrice.upsert({
    where: { planId_currency: { planId, currency } },
    update: { amount },
    create: { planId, currency, amount },
  });
  await db.servicePlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } } });
  await audit(user, {
    action: "plan_price.set", entity: "ServicePlan", entityId: planId,
    before: before ? { currency, amount: before.amount.toString() } : null, after: { currency, amount },
  });
  redirect(`/services?cat=${plan.categoryId}&cur=${currency}`);
}

async function addCategory(formData: FormData) {
  "use server";
  const user = await requirePermission("catalog.edit");
  try {
    const c = await createCategory(db, { organizationId: user.organizationId, name: String(formData.get("name") ?? "") });
    await audit(user, { action: "catalog.category_create", entity: "ServiceCategory", entityId: c.id, after: { name: c.name } });
    redirect(`/services?cat=${c.id}`);
  } catch (e) {
    if (e instanceof CatalogError) redirect(`/services?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

async function addPlan(formData: FormData) {
  "use server";
  const user = await requirePermission("catalog.edit");
  let id: string;
  try {
    const p = await createPlan(db, { organizationId: user.organizationId, categoryId: String(formData.get("categoryId") ?? ""), name: String(formData.get("name") ?? ""), tagline: String(formData.get("tagline") ?? ""), billingInterval: String(formData.get("billingInterval") ?? "") });
    id = p.id;
    await audit(user, { action: "catalog.plan_create", entity: "ServicePlan", entityId: p.id, after: { name: p.name } });
  } catch (e) {
    if (e instanceof CatalogError) redirect(`/services?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/services/${id}`);
}

export default async function Services({ searchParams }: { searchParams: Promise<{ cat?: string; cur?: string; error?: string }> }) {
  const user = await requirePermission("catalog.view");
  const { cat, cur, error } = await searchParams;
  const currency = (CURRENCIES as readonly string[]).includes(cur ?? "") ? (cur as string) : "AED";
  const canEdit = user.permissions.has("catalog.edit");
  const categories = await db.serviceCategory.findMany({
    where: { organizationId: user.organizationId, active: true },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { plans: true } } },
  });
  const selected = categories.find((c) => c.id === cat) ?? categories.find((c) => c._count.plans > 0) ?? categories[0];
  const plans = selected
    ? await db.servicePlan.findMany({
        where: { categoryId: selected.id, active: true },
        orderBy: { sortOrder: "asc" },
        include: { prices: true, features: { orderBy: { sortOrder: "asc" } } },
      })
    : [];
  const q = (c: string, k: string) => `/services?cat=${c}&cur=${k}`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service Catalog & Pricing</h1>
          <p className="text-sm text-muted">
            Each currency has its own price. A plan shows &quot;Price not set&quot; until one is entered; nothing is auto-converted.
            Seed prices are examples, not final.
          </p>
        </div>
        <nav aria-label="Currency" className="flex gap-1">
          {CURRENCIES.map((k) => (
            <Link key={k} href={q(selected?.id ?? "", k)} className={`btn-ghost ${k === currency ? "!bg-primary !text-white !border-primary" : ""}`}>{k}</Link>
          ))}
        </nav>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <nav aria-label="Categories" className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <Link key={c.id} href={q(c.id, currency)} className={`btn-ghost ${c.id === selected?.id ? "!bg-navy !text-white" : ""}`}>
            {c.name}{c._count.plans > 0 && ` (${c._count.plans})`}
          </Link>
        ))}
      </nav>
      {plans.length === 0 ? (
        <div className="card text-sm text-muted">No plans in this category yet.</div>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((p) => {
            const price = p.prices.find((x) => x.currency === currency);
            return (
              <article key={p.id} className={`card space-y-4 ${p.isPopular ? "ring-2 ring-brand" : ""}`}>
                {p.isPopular && <span className="inline-block rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">Most Popular</span>}
                <h2 className="text-lg font-bold">{p.name}</h2>
                <p className="text-3xl font-bold">
                  {price ? formatMoney(price.amount, currency) : <span className="text-base font-medium text-muted">Price not set</span>}
                  {price && <span className="text-sm font-normal text-muted"> / {p.billingInterval.toLowerCase().replace("_", " ")}</span>}
                </p>
                <ul className="space-y-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f.id} className="flex gap-2"><span aria-hidden className="text-brand">✓</span>{f.text}</li>
                  ))}
                </ul>
                {canEdit && <Link className="text-sm underline" href={`/services/${p.id}`}>Edit plan, features and prices</Link>}
                {canEdit && (
                  <form action={setPrice} className="flex gap-2 border-t border-border pt-3">
                    <input type="hidden" name="planId" value={p.id} />
                    <input type="hidden" name="currency" value={currency} />
                    <input name="amount" required inputMode="decimal" placeholder={`${currency} price`} aria-label={`${p.name} ${currency} price`} className="input" />
                    <button className="btn-ghost">Set</button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
      {canEdit && (
        <div className="grid gap-5 md:grid-cols-2">
          <form action={addCategory} className="card space-y-3">
            <h2 className="font-semibold">New category</h2>
            <input name="name" required maxLength={80} aria-label="Category name" placeholder="e.g. Video Production" className="input" />
            <button className="btn">Add category</button>
          </form>
          {selected && (
            <form action={addPlan} className="card space-y-3">
              <h2 className="font-semibold">New plan in {selected.name}</h2>
              <input type="hidden" name="categoryId" value={selected.id} />
              <input name="name" required maxLength={100} aria-label="Plan name" placeholder="Plan name" className="input" />
              <input name="tagline" aria-label="Tagline" placeholder="Tagline (optional)" className="input" />
              <select name="billingInterval" aria-label="Billing" defaultValue="MONTHLY" className="input">{INTERVALS.map((i) => <option key={i} value={i}>{i.toLowerCase().replace("_", " ")}</option>)}</select>
              <button className="btn">Add plan, then set prices</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
