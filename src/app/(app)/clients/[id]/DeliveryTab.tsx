import Link from "next/link";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { PURPOSE_LABEL, weekStartOf } from "@/lib/delivery";
import { Badge, Empty, StatusBadge, SubmitButton } from "@/components/ui";
import { createMeetingAction } from "../../meetings/actions";
import { attachRecording, saveReview } from "./delivery-actions";

export default async function DeliveryTab({ organizationId, client, canEdit, canMeet, canWatch, pmName }: { organizationId: string; client: { id: string; name: string; currency: string; projectManagerId: string | null }; canEdit: boolean; canMeet: boolean; canWatch: boolean; pmName: string | null }) {
  const [meetings, reviews, tiers] = await Promise.all([
    db.meeting.findMany({ where: { organizationId, clientId: client.id, purpose: { in: ["DISCOVERY", "WEEKLY_REVIEW"] } }, orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }], take: 20 }),
    db.clientReview.findMany({ where: { organizationId, clientId: client.id }, orderBy: { weekStart: "desc" }, take: 20 }),
    db.reviewRebateTier.findMany({ where: { organizationId }, orderBy: { minRating: "desc" } }),
  ]);
  const recs = new Map<string, { id: string; startedAt: Date }[]>();
  if (canWatch) for (const r of await db.meetingRecording.findMany({ where: { organizationId, status: "READY", meetingId: { in: meetings.map((m) => m.id) } }, orderBy: { startedAt: "desc" } })) recs.set(r.meetingId, [...(recs.get(r.meetingId) ?? []), r]);
  const reviewers = new Map((await db.user.findMany({ where: { id: { in: [...new Set(reviews.map((r) => r.reviewerId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const week = weekStartOf(new Date().toISOString().slice(0, 10));
  const returnTo = `/clients/${client.id}?tab=delivery`;
  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <h2 className="font-semibold">Delivery</h2>
        <p className="text-sm text-muted">Project manager: <strong className="text-foreground">{pmName ?? "not allocated yet"}</strong>{pmName ? "" : " (set it on the Services tab)"}. The project manager approves each content entry before the client sees it; then the client approves it in the portal calendar, then the social media manager posts it.</p>
        <p className="text-sm"><Link className="underline" href={`/content?client=${client.id}`}>Open this client&apos;s content calendar</Link></p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Discovery call and weekly reviews</h2>
        {meetings.length === 0 ? <Empty title="No calls yet">Schedule the business discovery call below. It happens in the ERP&apos;s meeting room.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {meetings.map((m) => (
              <li key={m.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/meetings/${m.id}`} className="font-medium hover:underline">{m.title}</Link><span className="flex items-center gap-2 text-xs text-muted">{PURPOSE_LABEL[m.purpose]}{m.scheduledAt ? ` · ${m.scheduledAt.toLocaleString()}` : ""}<StatusBadge status={m.status} /></span></div>
                {m.recordingUrl ? <p className="text-xs"><a className="underline" href={m.recordingUrl} target="_blank" rel="noopener noreferrer">Recording link</a></p> : null}
                {canWatch && (recs.get(m.id) ?? []).map((r) => <p key={r.id} className="text-xs"><a className="underline" href={`/api/meetings/${m.id}/recording/${r.id}`}>Download recording of {r.startedAt.toLocaleDateString()}</a></p>)}
                {!m.recordingUrl && !(recs.get(m.id) ?? []).length && <p className="text-xs text-muted">No recording yet.</p>}
                {canMeet && (
                  <form action={attachRecording} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="meetingId" value={m.id} />
                    <label className="sr-only" htmlFor={`rec-${m.id}`}>Recording link</label>
                    <input id={`rec-${m.id}`} name="url" defaultValue={m.recordingUrl ?? ""} placeholder="https:// link to the recording" className="input min-w-60 flex-1" />
                    <SubmitButton className="btn-ghost" pendingText="Saving…">Save link</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Hosts with the recordings permission can record from inside the meeting room (everyone sees a recording banner). A recording made with another tool can be attached as a link.</p>
        {canMeet && (
          <form action={createMeetingAction} className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
            <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="returnTo" value={returnTo} />
            <div><label className="label" htmlFor="dm-purpose">Call</label><select id="dm-purpose" name="purpose" className="input"><option value="DISCOVERY">Business discovery call</option><option value="WEEKLY_REVIEW">Weekly review</option></select></div>
            <div><label className="label" htmlFor="dm-title">Title</label><input id="dm-title" name="title" required maxLength={140} defaultValue={`Discovery call: ${client.name}`} className="input" /></div>
            <div><label className="label" htmlFor="dm-at">When</label><input id="dm-at" name="scheduledAt" type="datetime-local" className="input" /></div>
            <input type="hidden" name="durationMin" value="60" /><input type="hidden" name="waitingRoom" value="on" />
            <div className="sm:col-span-3"><SubmitButton pendingText="Scheduling…">Schedule call</SubmitButton></div>
          </form>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Weekly customer success reviews</h2>
        {tiers.length === 0
          ? <p className="text-xs text-muted">No rebate tiers are set, so reviews do not earn the team a rebate yet. Finance sets them under Finance, Commissions.</p>
          : <p className="text-xs text-muted">Rebate for the team from this client&apos;s weekly retainer: {tiers.map((t) => `${t.minRating}+ stars ${t.percent}%`).join(", ")}. Shared equally between the project manager and the staff on this client&apos;s active projects, as bonuses waiting for approval.</p>}
        {reviews.length === 0 ? <p className="text-sm text-muted">No reviews yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {reviews.map((r) => (
              <li key={r.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Week of {r.weekStart}: {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span><span className="text-xs text-muted">by {reviewers.get(r.reviewerId) ?? "staff"}{r.rebatePercent.gt(0) ? <> · <Badge tone="success">{formatMoney(r.rebatePool, r.currency)} for the team</Badge></> : ""}</span></div>
                <p className="whitespace-pre-line text-muted">{r.review}</p>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form action={saveReview} className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
            <input type="hidden" name="clientId" value={client.id} />
            <div><label className="label" htmlFor="rv-week">Week of</label><input id="rv-week" name="weekOf" type="date" required defaultValue={week} className="input" /></div>
            <div><label className="label" htmlFor="rv-rating">Rating</label><select id="rv-rating" name="rating" className="input" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} of 5</option>)}</select></div>
            <div><label className="label" htmlFor="rv-meeting">Review call (optional)</label><select id="rv-meeting" name="meetingId" className="input"><option value="">None</option>{meetings.filter((m) => m.purpose === "WEEKLY_REVIEW").map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></div>
            <div className="sm:col-span-3"><label className="label" htmlFor="rv-text">What the client said</label><textarea id="rv-text" name="review" required rows={3} maxLength={2000} className="input" /></div>
            <div className="sm:col-span-3"><SubmitButton pendingText="Saving…">Record review</SubmitButton></div>
          </form>
        )}
      </section>
    </div>
  );
}
