import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PLATFORM_META, POST_TYPE_LABEL } from "@/lib/content-rules";
import { Avatar, Empty, Notice, PageHeader, Stat } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import CalendarGrid, { type CalItem } from "./CalendarGrid";
import ContentFilters from "./ContentFilters";
import PostForm, { PlatformDot } from "./PostForm";
import { STATUS_STYLE } from "./status-style";

export const dynamic = "force-dynamic";

type SP = { view?: string; m?: string; q?: string; platform?: string; type?: string; status?: string; owner?: string; client?: string; new?: string; date?: string; error?: string };
const isMonth = (v?: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v ?? "");
const shift = (month: string, by: number) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); return d.toISOString().slice(0, 7); };

export default async function ContentCalendar({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("content.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canManage = user.permissions.has("content.manage");
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true } });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: profile?.timezone ?? "UTC" });
  const view = sp.view === "sheet" ? "sheet" : "calendar";
  const all = view === "sheet" && sp.m === "all";
  const month = isMonth(sp.m) ? sp.m! : today.slice(0, 7);

  const [rows, clients, people] = await Promise.all([
    db.contentItem.findMany({ where: { organizationId: org, ...(all ? {} : { plannedDate: { startsWith: month } }) }, orderBy: [{ plannedDate: "asc" }, { plannedTime: "asc" }, { createdAt: "asc" }], take: 1500 }),
    db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { organizationId: org, active: true, userType: "EMPLOYEE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const personName = new Map(people.map((p) => [p.id, p.name]));

  // The four cards describe the whole month, whatever the filters say
  const inMonth = rows.filter((r) => r.plannedDate?.startsWith(month));
  const published = inMonth.filter((r) => r.status === "PUBLISHED").length;
  const ready = inMonth.filter((r) => r.status === "APPROVED" || r.status === "SCHEDULED").length;
  const todayCount = rows.filter((r) => r.plannedDate === today).length;

  const q = sp.q?.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (!sp.platform || r.platforms.includes(sp.platform)) && (!sp.type || r.postType === sp.type) && (!sp.status || r.status === sp.status) &&
    (!sp.owner || (sp.owner === "none" ? !r.assignedToId : r.assignedToId === sp.owner)) && (!sp.client || (sp.client === "none" ? !r.clientId : r.clientId === sp.client)) &&
    (!q || `${r.title} ${r.copy} ${r.hashtags ?? ""}`.toLowerCase().includes(q)));
  const items: CalItem[] = shown.filter((r) => r.plannedDate).map((r) => ({
    id: r.id, title: r.title, date: r.plannedDate!, time: r.plannedTime, status: r.status, platforms: r.platforms.length ? r.platforms : [r.platform], postType: r.postType,
    client: r.clientId ? clientName.get(r.clientId) ?? null : null, assignee: r.assignedToId ? personName.get(r.assignedToId) ?? null : null, assigneeId: r.assignedToId,
  }));
  const unscheduled = shown.filter((r) => !r.plannedDate).length;

  const filterKeys = ["q", "platform", "type", "status", "owner", "client"] as const;
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = { view: view === "sheet" ? "sheet" : undefined, m: sp.m, ...Object.fromEntries(filterKeys.map((k) => [k, sp[k]])), ...over };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const t = p.toString();
    return `/content${t ? `?${t}` : ""}`;
  };
  const monthLabel = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const pct = inMonth.length ? Math.round((published / inMonth.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Content calendar" subtitle="Plan daily social-media content: type, caption, platforms, date and time, with the creative attached and approved before it goes out. Posts are marked published by a person; nothing is posted to the platforms automatically."
        actions={canManage ? <Link href={qs({ new: "1", date: undefined })} className="btn">+ New post</Link> : undefined} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="This month" value={inMonth.length} hint={inMonth.length === 1 ? "post planned" : "posts planned"} />
        <div className="card !p-4"><p className="text-xs font-medium text-muted">Posted</p><p className="mt-1 text-2xl font-semibold tracking-tight text-success">{published}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-success transition-all duration-700" style={{ width: `${pct}%` }} /></div></div>
        <Stat label="Ready to post" value={ready} hint="approved or scheduled" />
        <Stat label="Today" value={todayCount} hint={todayCount === 1 ? "post planned" : "posts planned"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {!all && <>
            <Link href={qs({ m: shift(month, -1) })} aria-label="Previous month" className="btn-ghost !px-3">‹</Link>
            <span className="min-w-36 text-center text-sm font-semibold">{monthLabel}</span>
            <Link href={qs({ m: shift(month, 1) })} aria-label="Next month" className="btn-ghost !px-3">›</Link>
            <Link href={qs({ m: undefined })} className="btn-ghost">Today</Link>
          </>}
          {view === "sheet" && <Link href={qs({ m: all ? month : "all" })} className="btn-ghost">{all ? "Show one month" : "All dates"}</Link>}
        </div>
        <div className="inline-flex rounded-xl border border-border bg-surface p-1 text-sm" role="tablist" aria-label="View">
          <Link href={qs({ view: undefined, m: sp.m === "all" ? undefined : sp.m })} role="tab" aria-selected={view === "calendar"} className={`rounded-lg px-4 py-1.5 font-medium transition ${view === "calendar" ? "bg-primary text-white shadow" : "text-muted hover:text-foreground"}`}>Calendar</Link>
          <Link href={qs({ view: "sheet" })} role="tab" aria-selected={view === "sheet"} className={`rounded-lg px-4 py-1.5 font-medium transition ${view === "sheet" ? "bg-primary text-white shadow" : "text-muted hover:text-foreground"}`}>Sheet</Link>
        </div>
      </div>

      <ContentFilters people={people} clients={clients} />
      {unscheduled > 0 && view === "calendar" && <Notice kind="ok">{unscheduled} post{unscheduled === 1 ? " has" : "s have"} no date yet. <Link href={qs({ view: "sheet", m: "all" })} className="underline">Open them in the sheet</Link>.</Notice>}

      {view === "calendar" ? (
        <CalendarGrid key={`${month}|${items.map((i) => `${i.id}:${i.date}:${i.status}`).join(",")}`} month={month} today={today} items={items} canManage={canManage} newHrefBase={qs({ new: undefined, date: undefined })} />
      ) : shown.length === 0 ? (
        <Empty title="No posts match">Change the filters or plan a new post.</Empty>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Date</th><th className="pr-4">Post</th><th className="pr-4">Client</th><th className="pr-4">Type</th><th className="pr-4">Platforms</th><th className="pr-4">Status</th><th className="pr-4">Assigned to</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.DRAFT, plats = r.platforms.length ? r.platforms : [r.platform], who = r.assignedToId ? personName.get(r.assignedToId) : null;
                return (
                  <tr key={r.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{r.plannedDate ?? "No date"}{r.plannedTime ? ` · ${r.plannedTime}` : ""}</td>
                    <td className="pr-4"><Link href={`/content/${r.id}`} className="font-medium hover:underline">{r.title}</Link></td>
                    <td className="pr-4 text-muted">{r.clientId ? clientName.get(r.clientId) : "Our own"}</td>
                    <td className="pr-4">{POST_TYPE_LABEL[r.postType] ?? r.postType}</td>
                    <td className="pr-4"><span className="flex items-center gap-1">{plats.map((p) => <PlatformDot key={p} code={PLATFORM_META[p]?.code ?? "?"} color={PLATFORM_META[p]?.color ?? "#6b7280"} size={20} />)}</span></td>
                    <td className="pr-4"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.chip}`}>{st.label}</span></td>
                    <td className="pr-4">{who ? <span className="flex items-center gap-2"><Avatar name={who} userId={r.assignedToId} size={22} />{who}</span> : <span className="text-muted">Unassigned</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage && sp.new && (
        <Drawer title="Plan a post" closeTo={qs({ new: undefined, date: undefined, error: undefined })}>
          <PostForm clients={clients} people={people} defaultDate={/^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today} closeTo={qs({ new: undefined, date: undefined, error: undefined })} error={sp.error} />
        </Drawer>
      )}
    </div>
  );
}
