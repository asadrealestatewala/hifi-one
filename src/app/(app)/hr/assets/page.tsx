import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CONDITIONS, CONDITION_LABEL, ITEM_CATEGORIES } from "@/lib/asset-custody";
import { Badge, Chips, Empty, ListToolbar, NewButton, Notice, PageHeader, Pager, PanelForm, SearchBox, Stat } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import ScreenTabs from "@/components/shell/ScreenTabs";
import { recordItemAction } from "./actions";

export const dynamic = "force-dynamic";

const SIZE = 50;
const VIEWS = ["all", "with_staff", "in_stock", "unconfirmed", "leavers", "closed"] as const;
type View = (typeof VIEWS)[number];
type SP = { view?: string; q?: string; category?: string; page?: string; new?: string; error?: string; msg?: string };
const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// HR's register of company items: everything Finance bought through the books plus what HR records itself, who has each item,
// and what is waiting (receipts not confirmed, items still with people who have left).
export default async function CompanyAssets({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("assets.custody");
  const sp = await searchParams;
  const org = user.organizationId;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "all";
  const category = (ITEM_CATEGORIES as readonly string[]).includes(sp.category ?? "") ? sp.category : undefined;
  const q = sp.q?.trim().slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);

  const leavers = (await db.employeeProfile.findMany({ where: { organizationId: org, status: "EXITED" }, select: { userId: true } })).map((p) => p.userId);
  const active: Prisma.AssetWhereInput = { organizationId: org, status: "ACTIVE" };
  const unconfirmed: Prisma.AssetWhereInput = { assignments: { some: { returnedAt: null, acknowledgedAt: null } } };
  const viewWhere: Record<View, Prisma.AssetWhereInput> = {
    all: active,
    with_staff: { ...active, assignedToId: { not: null } },
    in_stock: { ...active, assignedToId: null },
    unconfirmed: { ...active, assignedToId: { not: null }, ...unconfirmed },
    leavers: { ...active, assignedToId: { in: leavers } },
    closed: { organizationId: org, status: { not: "ACTIVE" } },
  };
  const holders = q ? (await db.user.findMany({ where: { organizationId: org, name: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 50 })).map((u) => u.id) : [];
  const where: Prisma.AssetWhereInput = {
    ...viewWhere[view],
    ...(category ? { category } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { number: { contains: q, mode: "insensitive" } }, { serialNumber: { contains: q, mode: "insensitive" } }, { assignedToId: { in: holders } }] } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    db.asset.findMany({ where, orderBy: { number: "asc" }, skip: (page - 1) * SIZE, take: SIZE, include: { assignments: { where: { returnedAt: null }, orderBy: { assignedAt: "desc" }, take: 1 } } }),
    db.asset.count({ where }),
    Promise.all(VIEWS.map((v) => db.asset.count({ where: viewWhere[v] }))),
  ]);
  const count = Object.fromEntries(VIEWS.map((v, i) => [v, counts[i]])) as Record<View, number>;
  const people = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.assignedToId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true, employeeProfile: { select: { id: true } } } })).map((u) => [u.id, u]));
  const canHr = user.permissions.has("hr.view");
  const left = new Set(leavers);

  const href = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view: view === "all" ? undefined : view, q, category, ...over })) if (v) p.set(k, v);
    const t = p.toString();
    return `/hr/assets${t ? `?${t}` : ""}`;
  };
  const closeTo = href({ new: undefined });
  const labels: Record<View, string> = { all: "All in use", with_staff: "With staff", in_stock: "In stock", unconfirmed: "Receipt not confirmed", leavers: "With people who left", closed: "Written off" };

  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="hr-records" current="/hr/assets" />} title="Company assets"
        subtitle="Every company item and who has it: laptops and phones bought through Finance, and smaller items HR records here (SIMs, accessories, access cards). Issue an item, have the person confirm they received it, and take it back when they leave."
        actions={<NewButton href={href({ new: "1", page: undefined })}>Record an item</NewButton>} />
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.error && !sp.new && <Notice kind="error">{sp.error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Items in use" value={count.all} href={href({ view: undefined, page: undefined })} />
        <Stat label="With staff" value={count.with_staff} hint={`${count.in_stock} in stock`} href={href({ view: "with_staff", page: undefined })} />
        <Stat label="Receipt not confirmed" value={count.unconfirmed} href={href({ view: "unconfirmed", page: undefined })} tone={count.unconfirmed ? "amber" : undefined} />
        <Stat label="With people who left" value={count.leavers} hint={count.leavers ? "take these back" : undefined} href={href({ view: "leavers", page: undefined })} tone={count.leavers ? "pink" : undefined} />
      </div>
      <ListToolbar
        search={<SearchBox q={q} placeholder="Search item, tag, serial or person" hidden={{ view: view === "all" ? undefined : view, category }} />}
        filters={(
          <form method="get" action="/hr/assets" className="flex items-center gap-2 text-sm">
            {view !== "all" && <input type="hidden" name="view" value={view} />}
            {q && <input type="hidden" name="q" value={q} />}
            <label className="label !mb-0" htmlFor="category">Category</label>
            <select id="category" name="category" className="input !w-auto !py-1" defaultValue={category ?? ""}><option value="">All</option>{ITEM_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            <button className="btn-ghost">Filter</button>
          </form>
        )}
      >
        <Chips current={view} items={VIEWS.map((v) => ({ key: v, label: labels[v], count: count[v], href: href({ view: v === "all" ? undefined : v, page: undefined }) }))} />
      </ListToolbar>

      {rows.length === 0 ? (
        <Empty title={q || category || view !== "all" ? "Nothing matches" : "No company items yet"}>
          {q || category || view !== "all" ? "Change the search or filter to see other items." : "Record the items people use, starting with laptops and phones. Items Finance buys through Fixed assets appear here on their own."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Tag</th><th className="pr-4">Item</th><th className="pr-4">Serial</th><th className="pr-4">With</th><th className="pr-4">Since</th><th className="pr-4">Condition</th><th className="pr-4">Status</th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const h = a.assignments[0];
                return (
                  <tr key={a.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-2.5 text-muted"><Link href={`/hr/assets/${a.id}`} className="hover:underline">{a.number}</Link></td>
                    <td className="pr-4"><Link href={`/hr/assets/${a.id}`} className="block font-medium hover:underline">{a.name}</Link><span className="text-xs text-muted">{a.category ?? "Uncategorised"}</span></td>
                    <td className="pr-4 text-muted">{a.serialNumber}</td>
                    <td className="pr-4">{a.assignedToId ? (canHr && people.get(a.assignedToId)?.employeeProfile ? <Link className="hover:underline" href={`/hr/employees/${people.get(a.assignedToId)!.employeeProfile!.id}#items`}>{people.get(a.assignedToId)!.name}</Link> : people.get(a.assignedToId)?.name ?? "Unknown") : <span className="text-muted">{a.status === "ACTIVE" ? "In stock" : ""}</span>}</td>
                    <td className="pr-4 text-muted">{h ? when(h.assignedAt) : ""}</td>
                    <td className="pr-4">{CONDITION_LABEL[a.condition] ?? a.condition}</td>
                    <td className="py-2 pr-4"><span className="flex flex-wrap gap-1">
                      {a.status !== "ACTIVE" && <Badge tone="neutral">{a.inBooks ? "disposed by Finance" : "written off"}</Badge>}
                      {h && !h.acknowledgedAt && <Badge tone="warning">receipt not confirmed</Badge>}
                      {a.assignedToId && left.has(a.assignedToId) && <Badge tone="danger">person has left</Badge>}
                      {a.inBooks && <Badge tone="info">in the books</Badge>}
                    </span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={page} size={SIZE} total={total} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
        </div>
      )}

      {sp.new && (
        <Drawer title="Record an item" closeTo={closeTo}>
          <PanelForm action={recordItemAction} closeTo={closeTo} submit="Record item" error={sp.error} hint="Not posted to the books.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="name">Item</label><input id="name" name="name" required minLength={2} maxLength={120} placeholder="Jazz SIM 0300-1234567" className="input" /></div>
              <div><label className="label" htmlFor="new-category">Category</label><select id="new-category" name="category" required className="input" defaultValue=""><option value="" disabled>Choose</option>{ITEM_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label className="label" htmlFor="condition">Condition</label><select id="condition" name="condition" className="input" defaultValue="NEW">{CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}</select></div>
              <div><label className="label" htmlFor="serialNumber">Serial or IMEI number</label><input id="serialNumber" name="serialNumber" maxLength={80} className="input" /></div>
              <div><label className="label" htmlFor="location">Where it is kept</label><input id="location" name="location" maxLength={120} placeholder="Islamabad office, HR cupboard" className="input" /></div>
              <div><label className="label" htmlFor="purchaseDate">Bought on (optional)</label><input id="purchaseDate" name="purchaseDate" type="date" className="input" /></div>
              <div><label className="label" htmlFor="cost">Cost, for reference (optional)</label><input id="cost" name="cost" inputMode="decimal" className="input" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" maxLength={1000} rows={3} className="input" placeholder="Charger included, scratch on the lid" /></div>
            </div>
            <p className="text-xs text-muted">After saving you can add photos and issue the item to someone. Equipment Finance buys through the books is recorded under Fixed assets and appears here on its own.</p>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
