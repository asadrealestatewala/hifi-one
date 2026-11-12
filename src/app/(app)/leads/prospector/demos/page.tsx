import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO_MODES, DEMO_MODE_LABEL, DEMO_STATUS_LABEL, demoQueue, trainers, type DemoMode, type DemoStatus } from "@/lib/demo-bookings";
import { listProducts, zoneOffsetMinutes } from "@/lib/field-visits";
import { companyZone } from "@/lib/mobile-api";
import { Badge, Chips, ConfirmButton, Empty, Notice, PageHeader, Pager, SearchBox, SubmitButton } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import { closeDemoAction, scheduleDemoAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { tab?: string; product?: string; q?: string; page?: string; ok?: string; error?: string };

// The onboarding team's queue (decision 73): businesses that asked a field agent for a demo. Booking a time makes the lead.
export default async function DemoQueue({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("prospector.schedule_demo");
  const sp = await searchParams;
  const zone = await companyZone(user.organizationId);
  const tzOffset = zoneOffsetMinutes(zone);
  const [queue, products, team] = await Promise.all([
    demoQueue(db, user, { tab: sp.tab, productId: sp.product || undefined, q: sp.q, page: Number(sp.page) || 1 }),
    listProducts(db, user.organizationId),
    trainers(db, user.organizationId),
  ]);
  const href = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab: queue.tab, product: sp.product, q: sp.q, ...over })) if (v) p.set(k, String(v));
    const qs = p.toString();
    return `/leads/prospector/demos${qs ? `?${qs}` : ""}`;
  };
  const back = href({ page: sp.page });
  const when = (d: Date | null) => (d ? d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zone }) : "");
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: zone });
  // default for the picker: tomorrow 11:00 in the company's zone
  const tomorrow = new Date(Date.now() + tzOffset * 60_000 + 86_400_000); tomorrow.setUTCHours(11, 0, 0, 0);
  const defaultAt = tomorrow.toISOString().slice(0, 16);
  const tone = (s: string) => (s === "SCHEDULED" ? "primary" : s === "DONE" ? "success" : s === "REQUESTED" ? "warning" : s === "NO_SHOW" ? "danger" : "neutral");

  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="crm-prospector" current="/leads/prospector/demos" />} title="Prospector" subtitle="Businesses that asked a field agent for a demo. Book the time; the business then becomes a lead of the agent who found it." actions={<Link className="btn-ghost" href="/leads/prospector">Back to Prospector</Link>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <Chips current={queue.tab} items={[
          { key: "requested", label: "Requested", count: queue.counts.requested, href: href({ tab: "requested", page: undefined }) },
          { key: "scheduled", label: "Booked", count: queue.counts.scheduled, href: href({ tab: "scheduled", page: undefined }) },
          { key: "done", label: "Done", count: queue.counts.done, href: href({ tab: "done", page: undefined }) },
        ]} />
        <SearchBox q={sp.q} placeholder="Business, owner, phone or city" hidden={{ tab: queue.tab, product: sp.product }} />
        {products.length > 1 && (
          <nav aria-label="Solution" className="flex flex-wrap gap-1.5 text-[13px]">
            <Link href={href({ product: undefined, page: undefined })} aria-current={!sp.product ? "page" : undefined} className={`rounded-full border px-3 py-1 ${!sp.product ? "border-primary text-primary" : "border-border text-muted"}`}>All solutions</Link>
            {products.map((p) => <Link key={p.id} href={href({ product: p.id, page: undefined })} aria-current={sp.product === p.id ? "page" : undefined} className={`rounded-full border px-3 py-1 ${sp.product === p.id ? "border-primary text-primary" : "border-border text-muted"}`}>{p.name}</Link>)}
          </nav>
        )}
      </div>

      {queue.rows.length === 0 ? (
        <Empty title={queue.tab === "requested" ? "No demo requests waiting" : queue.tab === "scheduled" ? "No demos booked" : "Nothing finished yet"}>
          {queue.tab === "requested" ? "When a field agent logs a visit with the outcome Demo requested, it appears here." : "Booked demos and their outcomes are listed on the other tabs."}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {queue.rows.map((r) => {
            const p = r.prospect;
            const maps = p.lat !== null && p.lng !== null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : null;
            const open = r.status === "REQUESTED" || r.status === "SCHEDULED";
            return (
              <li key={r.id} className="card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name} {r.product && <span className="text-sm font-normal text-muted">· {r.product.name}</span>}</p>
                    <p className="text-sm text-muted">{[p.contactName, p.address, p.city].filter(Boolean).join(" · ") || "No address given"}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                      {p.phone && <a className="underline" href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>{p.phone}</a>}
                      {p.email && <a className="underline" href={`mailto:${p.email}`}>{p.email}</a>}
                      {!p.phone && !p.email && <span className="text-brand">No phone or email yet: the agent must add one before this can be booked.</span>}
                      {maps && <a className="underline" href={maps} target="_blank" rel="noreferrer">Map</a>}
                      {r.leadId && <Link className="underline" href={`/leads/${r.leadId}`}>Open lead</Link>}
                    </p>
                  </div>
                  <Badge tone={tone(r.status)}>{DEMO_STATUS_LABEL[r.status as DemoStatus] ?? r.status}</Badge>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div className="flex gap-2"><dt className="text-muted">Asked</dt><dd>{day(r.requestedAt)} by {r.requestedByName}{r.photos ? ` · ${r.photos} photo${r.photos === 1 ? "" : "s"}` : ""}</dd></div>
                  {r.preferredNote && <div className="flex gap-2 sm:col-span-2"><dt className="text-muted">Owner said</dt><dd className="whitespace-pre-line">{r.preferredNote}</dd></div>}
                  {r.scheduledAt && <div className="flex gap-2"><dt className="text-muted">Demo</dt><dd>{when(r.scheduledAt)}{r.mode ? `, ${DEMO_MODE_LABEL[r.mode as DemoMode]?.toLowerCase() ?? r.mode}` : ""}{r.trainerName ? `, ${r.trainerName}` : ""}</dd></div>}
                  {r.note && <div className="flex gap-2 sm:col-span-2"><dt className="text-muted">Note</dt><dd>{r.note}</dd></div>}
                  {r.closedAt && <div className="flex gap-2 sm:col-span-2"><dt className="text-muted">{DEMO_STATUS_LABEL[r.status as DemoStatus]}</dt><dd>{day(r.closedAt)}{r.closedByName ? ` by ${r.closedByName}` : ""}{r.closeReason ? `: ${r.closeReason}` : ""}</dd></div>}
                </dl>
                {open && (
                  <details className="rounded-xl border border-border p-3" open={r.status === "REQUESTED" && queue.rows.length === 1}>
                    <summary className="cursor-pointer text-sm font-medium">{r.status === "REQUESTED" ? "Book the demo" : "Move the demo"}</summary>
                    <form action={scheduleDemoAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="tzOffset" value={-tzOffset} />
                      <div><label className="label" htmlFor={`at-${r.id}`}>Date and time ({zone})</label><input id={`at-${r.id}`} name="scheduledAt" type="datetime-local" required className="input" defaultValue={r.scheduledAt ? new Date(r.scheduledAt.getTime() + tzOffset * 60_000).toISOString().slice(0, 16) : defaultAt} /></div>
                      <div><label className="label" htmlFor={`tr-${r.id}`}>Given by</label><select id={`tr-${r.id}`} name="trainerId" className="input" defaultValue={r.trainerId ?? user.id}>{team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
                      <div><label className="label" htmlFor={`md-${r.id}`}>How</label><select id={`md-${r.id}`} name="mode" className="input" defaultValue={r.mode ?? "ON_SITE"}>{DEMO_MODES.map((m) => <option key={m} value={m}>{DEMO_MODE_LABEL[m]}</option>)}</select></div>
                      <div><label className="label" htmlFor={`nt-${r.id}`}>Note for the agent and trainer</label><input id={`nt-${r.id}`} name="note" maxLength={1000} className="input" defaultValue={r.note ?? ""} placeholder="Bring the tablet, ask for Mr Khan…" /></div>
                      <div className="sm:col-span-2 lg:col-span-4"><SubmitButton pendingText="Booking…">{r.status === "REQUESTED" ? "Book demo and make it a lead" : "Save new time"}</SubmitButton></div>
                    </form>
                  </details>
                )}
                {open && (
                  <div className="flex flex-wrap gap-2">
                    {r.status === "SCHEDULED" && (
                      <form action={closeDemoAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="status" value="DONE" /><SubmitButton className="btn-ghost" pendingText="Saving…">Demo held</SubmitButton></form>
                    )}
                    {r.status === "SCHEDULED" && (
                      <form action={closeDemoAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="status" value="NO_SHOW" /><ConfirmButton title="Nobody there?" message={`Mark the demo at ${p.name} as a no show. The agent is told and the lead stays open.`} confirmLabel="Mark no show">No show</ConfirmButton></form>
                    )}
                    <form action={closeDemoAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="status" value="CANCELLED" /><ConfirmButton title="Cancel this demo?" message={r.status === "REQUESTED" ? `${p.name} goes back to ${r.requestedByName}'s go-back list with your reason.` : `The lead for ${p.name} stays in the CRM; the cancellation and your reason go on its timeline.`} confirmLabel="Cancel demo" reason>Cancel</ConfirmButton></form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={queue.page} size={queue.size} total={queue.total} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
    </div>
  );
}
