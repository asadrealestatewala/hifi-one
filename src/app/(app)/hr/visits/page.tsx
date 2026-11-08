import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone, isDateString } from "@/lib/hr-rules";
import { VISIT_KIND_LABEL, describeVisit, type VisitKind } from "@/lib/site-visits";
import { Avatar, Badge, Empty, Notice, PageHeader, Stat, StatusBadge, SubmitButton, ConfirmButton } from "@/components/ui";
import { decideSiteVisitAction } from "../../me/visits/actions";

export const dynamic = "force-dynamic";

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// HR's view of who is out for work: today and the coming days, plus every request still waiting for a decision.
export default async function HrVisits({ searchParams }: { searchParams: Promise<{ from?: string; error?: string; msg?: string }> }) {
  const user = await requirePermission("attendance.view_all");
  const sp = await searchParams;
  const org = user.organizationId;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const today = dateInZone(new Date(), profile?.timezone ?? "UTC");
  const from = sp.from && isDateString(sp.from) ? sp.from : today;
  const to = addDays(from, 13);
  const [visits, pending] = await Promise.all([
    db.siteVisitRequest.findMany({ where: { organizationId: org, status: "APPROVED", endDate: { gte: from }, startDate: { lte: to } }, orderBy: [{ startDate: "asc" }, { startTime: { sort: "asc", nulls: "first" } }], include: { client: { select: { name: true } } } }),
    db.siteVisitRequest.findMany({ where: { organizationId: org, status: "PENDING" }, orderBy: [{ startDate: "asc" }, { createdAt: "asc" }], include: { client: { select: { name: true } } } }),
  ]);
  const ids = [...new Set([...visits, ...pending].map((v) => v.userId))];
  const people = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const onDay = (d: string) => visits.filter((v) => v.startDate <= d && v.endDate >= d);
  const todayCount = onDay(today).length;
  const weekday = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="space-y-5">
      <PageHeader title="Site visits & field work" subtitle="Who is out of the office for work, and requests waiting for a decision." actions={
        <form method="get" action="/hr/visits" className="flex items-center gap-2 text-sm"><Link href={`/hr/visits?from=${addDays(from, -14)}`} className="btn-ghost" aria-label="Earlier">‹</Link><input type="date" name="from" defaultValue={from} className="input !w-auto" /><button className="btn-ghost">Go</button><Link href={`/hr/visits?from=${addDays(from, 14)}`} className="btn-ghost" aria-label="Later">›</Link></form>
      } />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Out for work today" value={todayCount} />
        <Stat label="Approved in these two weeks" value={visits.length} />
        <Stat label="Waiting for a decision" value={pending.length} />
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">Waiting for a decision</h2>
        {pending.length === 0 ? <p className="text-sm text-muted">Nothing pending.</p> : pending.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
            <span className="flex items-center gap-2 font-medium w-44"><Avatar name={people.get(r.userId) ?? "?"} userId={r.userId} size={24} />{people.get(r.userId) ?? "Unknown"}</span>
            <span>{r.startDate}{r.endDate !== r.startDate && ` to ${r.endDate}`} · {describeVisit(r)}</span>
            <span className="text-muted">{r.purpose}</span>
            {r.startDate < today && <Badge tone="warning">already happened</Badge>}
            {r.userId !== user.id && (<>
              <form action={decideSiteVisitAction} className="flex items-center gap-1"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><input type="hidden" name="returnTo" value="/hr/visits" /><input name="note" placeholder="Note (optional)" aria-label="Decision note" className="input !w-40 !py-1" /><SubmitButton className="btn" pendingText="Saving…">Approve</SubmitButton></form>
              <form action={decideSiteVisitAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><input type="hidden" name="returnTo" value="/hr/visits" /><ConfirmButton title="Reject this request?" message="The employee is told why." confirmLabel="Reject" reason>Reject</ConfirmButton></form>
            </>)}
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Approved: {weekday(from)} to {weekday(to)}</h2>
        {visits.length === 0 ? <Empty title="Nobody is scheduled out">Approved site visits, field work and work-from-home days appear here by day.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {days.map((d) => { const v = onDay(d); return v.length === 0 ? null : (
              <li key={d} className="py-2">
                <p className={`text-xs font-semibold ${d === today ? "text-primary" : "text-muted"}`}>{weekday(d)}{d === today ? " · today" : ""}</p>
                <ul className="mt-1 space-y-1">
                  {v.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-2 font-medium"><Avatar name={people.get(r.userId) ?? "?"} userId={r.userId} size={22} />{people.get(r.userId) ?? "Unknown"}</span>
                      <Badge tone={r.kind === "WORK_FROM_HOME" ? "neutral" : "primary"}>{VISIT_KIND_LABEL[r.kind as VisitKind]}</Badge>
                      <span className="text-muted">{[r.client?.name, r.location, r.startTime && r.endTime ? `${r.startTime}–${r.endTime}` : null].filter(Boolean).join(" · ")} · {r.purpose}</span>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              </li>
            ); })}
          </ul>
        )}
      </section>
    </div>
  );
}
