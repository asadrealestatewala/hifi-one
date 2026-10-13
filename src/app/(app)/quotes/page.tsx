import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { CatalogError, resolvePlanLines } from "@/lib/catalog";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { SalesError, createQuote, expireQuotes } from "@/lib/sales";
import { Chips, Empty, NewButton, Notice, PageHeader, Pager, SearchBox, Stat, StatusBadge } from "@/components/ui";
import { paging } from "@/lib/paging";
import Drawer from "@/components/ui/Drawer";
import QuoteForm from "./QuoteForm";

export const dynamic = "force-dynamic";

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("quotes.manage");
  const fail = (m: string) => redirect(`/quotes?new=1&error=${encodeURIComponent(m)}`);
  const raw: { planId?: string; description: string; quantity: string; unitPrice: string }[] = [];
  for (let i = 0; i < 20; i++) {
    const description = String(formData.get(`desc${i}`) ?? "").trim();
    const quantity = String(formData.get(`qty${i}`) ?? "").trim();
    const unitPrice = String(formData.get(`price${i}`) ?? "").trim();
    const planId = String(formData.get(`plan${i}`) ?? "") || undefined;
    if (description || quantity || unitPrice || planId) raw.push({ planId, description, quantity, unitPrice });
  }
  let id: string;
  try {
    const lines = await resolvePlanLines(db, { organizationId: user.organizationId, currency: String(formData.get("currency") ?? ""), lines: raw });
    const q = await createQuote(db, {
      organizationId: user.organizationId, clientId: String(formData.get("clientId") ?? ""), currency: String(formData.get("currency") ?? ""),
      taxRate: String(formData.get("taxRate") || "0"), validUntil: String(formData.get("validUntil") ?? "") || null,
      notes: String(formData.get("notes") ?? "").trim() || null, terms: String(formData.get("terms") ?? "").trim() || null, createdById: user.id, lines,
    });
    id = q.id;
    await audit(user, { action: "quote.create", entity: "Quote", entityId: q.id, after: { number: q.number, total: q.total.toString(), currency: q.currency } });
  } catch (e) {
    if (e instanceof SalesError || e instanceof CatalogError) return fail(e.message);
    throw e;
  }
  redirect(`/quotes/${id}`);
}

type SP = { error?: string; status?: string; q?: string; new?: string; page?: string };

export default async function Quotes({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("quotes.view");
  const sp = await searchParams;
  const org = user.organizationId;
  await expireQuotes(db, org, new Date().toISOString().slice(0, 10));
  const canManage = user.permissions.has("quotes.manage");
  // Counts and the pipeline value come from aggregates over every quote; only the shown page is loaded
  const [counts, sentValue, clients, plans, rates] = await Promise.all([
    db.quote.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    db.quote.groupBy({ by: ["currency"], where: { organizationId: org, status: "SENT" }, _sum: { total: true } }),
    sp.new && canManage ? db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } }) : Promise.resolve([]),
    sp.new && canManage ? db.servicePlan.findMany({ where: { organizationId: org, active: true, category: { active: true } }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }], include: { category: true } }) : Promise.resolve([]),
    sp.new && canManage ? db.taxRate.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const byStatus = new Map(counts.map((c) => [c.status as string, c._count]));
  const statuses = [...byStatus.keys()];
  const status = statuses.includes(sp.status ?? "") ? sp.status! : "all";
  const q = sp.q?.trim();
  const where = {
    organizationId: org,
    ...(status !== "all" ? { status: status as never } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" as const } }, { client: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const pg = paging(sp.page);
  const [quotes, matched] = await Promise.all([
    db.quote.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pg.skip, take: pg.take, include: { client: true } }),
    db.quote.count({ where }),
  ]);
  const count = (s: string) => byStatus.get(s) ?? 0;
  const all = counts.reduce((n, c) => n + c._count, 0);
  const pipeline = new Map(sentValue.filter((r) => r._sum.total).map((r) => [r.currency, r._sum.total!]));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ status: status === "all" ? undefined : status, q: sp.q?.trim(), ...over })) if (v) p.set(k, v); const t = p.toString(); return `/quotes${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader title="Quotations" subtitle="Price the work, send it, and turn accepted quotes into invoices." actions={canManage ? <NewButton href={href({ new: "1" })}>New quotation</NewButton> : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Drafts" value={count("DRAFT")} />
        <Stat label="Sent, awaiting answer" value={count("SENT")} hint={pipeline.size ? [...pipeline].map(([c, v]) => formatMoney(v, c)).join(" · ") : undefined} />
        <Stat label="Accepted" value={count("ACCEPTED")} />
        <Stat label="Expired or declined" value={count("EXPIRED") + count("DECLINED")} />
      </div>
      {sp.error && !sp.new && <Notice kind="error">{sp.error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={sp.q?.trim()} placeholder="Search number or client" hidden={{ status: status === "all" ? undefined : status }} />
        <Chips current={status} items={[{ key: "all", label: "All", count: all, href: href({ status: undefined }) }, ...statuses.map((s) => ({ key: s, label: s.toLowerCase().replace(/^./, (c) => c.toUpperCase()), count: count(s), href: href({ status: s }) }))]} />
      </div>
      {quotes.length === 0 ? <Empty title={q || status !== "all" ? "No quotations match" : "No quotations yet"}>{canManage ? "Create one with New quotation." : "Quotations will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Number</th><th className="pr-4">Client</th><th className="pr-4">Status</th><th className="pr-4">Valid until</th><th className="pr-4 text-right">Total</th></tr></thead>
            <tbody>
              {quotes.map((x) => (
                <tr key={x.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/quotes/${x.id}`}>{x.number}</Link></td>
                  <td className="pr-4">{x.client.name}</td><td className="pr-4"><StatusBadge status={x.status} /></td><td className="pr-4 text-muted">{x.validUntil ?? ""}</td>
                  <td className="pr-4 text-right tabular-nums">{formatMoney(x.total, x.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
        </div>
      )}
      {canManage && sp.new && (
        <Drawer title="New quotation" closeTo={href({ new: undefined })}>
          <QuoteForm action={create} clients={clients} plans={plans.map((p) => ({ id: p.id, label: `${p.category.name}: ${p.name}` }))} taxPresets={rates.map((r) => ({ name: r.name, rate: r.ratePercent.toString() }))} closeTo={href({ new: undefined })} error={sp.error} />
        </Drawer>
      )}
    </div>
  );
}
