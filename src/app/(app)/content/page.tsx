import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PLATFORM_META, POST_TYPE_LABEL } from "@/lib/content-rules";
import { SubmitButton } from "@/components/ui";
import { bulkToClientAction, bulkToInternalAction } from "./actions";
import SelectAll from "./SelectAll";
import { Avatar, Empty, Notice, PageHeader, Stat } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import CalendarGrid, { type CalItem } from "./CalendarGrid";
import ContentFilters from "./ContentFilters";
import PostForm, { PlatformDot } from "./PostForm";
import { STATUS_STYLE } from "./status-style";

export const dynamic = "force-dynamic";

type SP = { view?: string; w?: string; bulk?: string; m?: string; q?: string; platform?: string; type?: string; status?: string; owner?: string; client?: string; new?: string; date?: string; error?: string };
const isMonth = (v?: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v ?? "");
const isDay = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");
// Monday of the week holding this date, and a date moved by some days
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (d: string) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
const shift = (month: string, by: number) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); return d.toISOString().slice(0, 7); };

export default async function ContentCalendar({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("content.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canManage = user.permissions.has("content.manage");
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true } });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: profile?.timezone ?? "UTC" });
  const view = sp.view === "sheet" ? "sheet" : sp.view === "week" ? "week" : "calendar";
  const weekStart = mondayOf(isDay(sp.w) ? sp.w! : today);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const all = view === "sheet" && sp.m === "all";
  const month = isMonth(sp.m) ? sp.m! : today.slice(0, 7);

  const [rows, clients, people] = await Promise.all([
    db.contentItem.findMany({ where: { organizationId: org, ...(view === "week" ? { plannedDate: { gte: weekDays[0], lte: weekDays[6] } } : all ? {} : { plannedDate: { startsWith: month } }) }, orderBy: [{ plannedDate: "asc" }, { plannedTime: "asc" }, { createdAt: "asc" }], take: 1500 }),
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
    const base: Record<string, string | undefined> = { view: view === "calendar" ? undefined : view, w: view === "week" ? weekStart : undefined, m: sp.m, ...Object.fromEntries(filterKeys.map((k) => [k, sp[k]])), ...over };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const t = p.toString();
    return `/content${t ? `?${t}` : ""}`;
  };
  const monthLabel = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const pct = inMonth.length ? Math.round((published / inMonth.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Content calendar" subtitle="Plan daily social-media content: type, caption, platforms, date and time, with the creative attached and approved before it goes out. Posts are marked published by a person; nothing is posted to the platforms automatically."
        actions={canManage ? <div className="flex gap-2">{user.permissions.has("content.publish") && <Link href="/content/accounts" className="btn-ghost">Social accounts</Link>}<Link href="/content/plan" className="btn-ghost">Plan the month with AI</Link><Link href={qs({ new: "1", date: undefined })} className="btn">+ New post</Link></div> : undefined} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="This month" value={inMonth.length} hint={inMonth.length === 1 ? "post planned" : "posts planned"} />
        <div className="card !p-4"><p className="text-xs font-medium text-muted">Posted</p><p className="mt-1 text-2xl font-semibold tracking-tight text-success">{published}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-success transition-all duration-700" style={{ width: `${pct}%` }} /></div></div>
        <Stat label="Ready to post" value={ready} hint="approved or scheduled" />
        <Stat label="Today" value={todayCount} hint={todayCount === 1 ? "post planned" : "posts planned"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {view === "week" && <>
            <Link href={qs({ w: addDays(weekStart, -7) })} aria-label="Previous week" className="btn-ghost !px-3">‹</Link>
            <span className="min-w-44 text-center text-sm font-semibold">{new Date(weekDays[0] + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} to {new Date(weekDays[6] + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</span>
            <Link href={qs({ w: addDays(weekStart, 7) })} aria-label="Next week" className="btn-ghost !px-3">›</Link>
            <Link href={qs({ w: undefined })} className="btn-ghost">This week</Link>
          </>}
          {!all && view !== "week" && <>
            <Link href={qs({ m: shift(month, -1) })} aria-label="Previous month" className="btn-ghost !px-3">‹</Link>
            <span className="min-w-36 text-center text-sm font-semibold">{monthLabel}</span>
            <Link href={qs({ m: shift(month, 1) })} aria-label="Next month" className="btn-ghost !px-3">›</Link>
            <Link href={qs({ m: undefined })} className="btn-ghost">Today</Link>
          </>}
          {view === "sheet" && <Link href={qs({ m: all ? month : "all" })} className="btn-ghost">{all ? "Show one month" : "All dates"}</Link>}
        </div>
        <div className="inline-flex rounded-xl border border-border bg-surface p-1 text-sm" role="tablist" aria-label="View">
          <Link href={qs({ view: undefined, m: sp.m === "all" ? undefined : sp.m })} role="tab" aria-selected={view === "calendar"} className={`rounded-lg px-4 py-1.5 font-medium transition ${view === "calendar" ? "bg-primary text-white shadow" : "text-muted hover:text-foreground"}`}>Calendar</Link>
          <Link href={qs({ view: "week", w: undefined, m: undefined })} role="tab" aria-selected={view === "week"} className={`rounded-lg px-4 py-1.5 font-medium transition ${view === "week" ? "bg-primary text-white shadow" : "text-muted hover:text-foreground"}`}>Week</Link>
          <Link href={qs({ view: "sheet" })} role="tab" aria-selected={view === "sheet"} className={`rounded-lg px-4 py-1.5 font-medium transition ${view === "sheet" ? "bg-primary text-white shadow" : "text-muted hover:text-foreground"}`}>Sheet</Link>
        </div>
      </div>

      <ContentFilters people={people} clients={clients} />
      {unscheduled > 0 && view === "calendar" && <Notice kind="ok">{unscheduled} post{unscheduled === 1 ? " has" : "s have"} no date yet. <Link href={qs({ view: "sheet", m: "all" })} className="underline">Open them in the sheet</Link>.</Notice>}

      {sp.bulk && <Notice kind="ok">{sp.bulk}</Notice>}
      {canManage && view !== "calendar" && shown.length > 0 && (
        <form id="bulk" action={bulkToInternalAction} className="card flex flex-wrap items-center gap-3 !py-3">
          <input type="hidden" name="back" value={qs({})} />
          <SelectAll form="bulk" />
          <span className="text-sm text-muted">Move the ticked posts:</span>
          <SubmitButton formAction={bulkToInternalAction} className="btn-ghost" pendingText="Moving…">To internal review</SubmitButton>
          <SubmitButton formAction={bulkToClientAction} className="btn-ghost" pendingText="Sending…">Send to client</SubmitButton>
          <span className="text-xs text-muted">Sending to the client needs the client&apos;s project manager. Posts that cannot move are listed after.</span>
        </form>
      )}

      {view === "week" ? (
        <div className="grid gap-3 md:grid-cols-7">
          {weekDays.map((d) => {
            const dayRows = shown.filter((r) => r.plannedDate === d);
            return (
              <section key={d} aria-label={d} className={`card min-w-0 space-y-2 !p-3 ${d === today ? "ring-2 ring-primary/40" : ""}`}>
                <h2 className="text-xs font-semibold text-muted">{new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</h2>
                {dayRows.length === 0 && <p className="text-xs text-muted">Nothing planned.</p>}
                {dayRows.map((r) => {
                  const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.DRAFT, plats = r.platforms.length ? r.platforms : [r.platform];
                  return (
                    <article key={r.id} className="space-y-1.5 rounded-xl border border-border p-2 text-sm">
                      <div className="flex items-start gap-2">
                        {canManage && <input type="checkbox" form="bulk" name="ids" value={r.id} aria-label={`Select ${r.title}`} className="mt-1" />}
                        <Link href={`/content/${r.id}`} className="min-w-0 font-medium leading-snug hover:underline">{r.title}</Link>
                      </div>
                      <p className="line-clamp-3 text-xs text-muted">{r.copy}</p>
                      <div className="flex flex-wrap items-center gap-1">
                        {plats.map((p) => <PlatformDot key={p} code={PLATFORM_META[p]?.code ?? "?"} color={PLATFORM_META[p]?.color ?? "#6b7280"} size={16} />)}
                        <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${st.chip}`}>{st.label}</span>
                        {r.aiRunId && r.status === "DRAFT" && <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">AI</span>}
                      </div>
                      <p className="text-[11px] text-muted">{r.clientId ? clientName.get(r.clientId) : "Our own"}{r.plannedTime ? ` · ${r.plannedTime}` : ""}</p>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      ) : view === "calendar" ? (
        <CalendarGrid key={`${month}|${items.map((i) => `${i.id}:${i.date}:${i.status}`).join(",")}`} month={month} today={today} items={items} canManage={canManage} newHrefBase={qs({ new: undefined, date: undefined })} />
      ) : shown.length === 0 ? (
        <Empty title="No posts match">Change the filters or plan a new post.</Empty>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr>{canManage && <th className="pl-4"><span className="sr-only">Select</span></th>}<th className="px-4 py-2.5">Date</th><th className="pr-4">Post</th><th className="pr-4">Client</th><th className="pr-4">Type</th><th className="pr-4">Platforms</th><th className="pr-4">Status</th><th className="pr-4">Assigned to</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.DRAFT, plats = r.platforms.length ? r.platforms : [r.platform], who = r.assignedToId ? personName.get(r.assignedToId) : null;
                return (
                  <tr key={r.id} className="border-t border-border transition hover:bg-hover/50">
                    {canManage && <td className="pl-4"><input type="checkbox" form="bulk" name="ids" value={r.id} aria-label={`Select ${r.title}`} /></td>}
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{r.plannedDate ?? "No date"}{r.plannedTime ? ` · ${r.plannedTime}` : ""}</td>
                    <td className="pr-4"><Link href={`/content/${r.id}`} className="font-medium hover:underline">{r.title}</Link>{r.aiRunId && r.status === "DRAFT" && <span className="ml-2 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">AI draft</span>}</td>
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
