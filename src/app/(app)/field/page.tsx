import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fieldHome, zoneOffsetMinutes, LAST_OUTCOME_LABEL } from "@/lib/field-visits";
import { DEMO_MODE_LABEL, type DemoMode } from "@/lib/demo-bookings";
import { getPolicy } from "@/lib/lead-duplicates";
import { companyZone } from "@/lib/mobile-api";
import { callingCodeOptions } from "@/lib/phone";
import { Badge, Notice, PageHeader } from "@/components/ui";
import FieldCapture from "./FieldCapture";

export const dynamic = "force-dynamic";

// The field agent's screen (decision 71, phase 2). One page, thumb first: today's count against the target, New visit (saved on the phone
// first, sent when there is signal), the shops to go back to, and today's visits. Works offline once it has been opened online.
export default async function FieldPage() {
  const user = await requirePermission("field.capture");
  const zone = await companyZone(user.organizationId);
  const tz = zoneOffsetMinutes(zone);
  const [home, policy] = await Promise.all([fieldHome(db, user, { tzOffsetMinutes: tz }), getPolicy(db, user.organizationId)]);
  const { profile, today, revisits, visits, demos } = home;
  const when = (d: Date) => d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zone });
  const ready = Boolean(profile.productId) && (profile.kind === "FIELD" || user.permissions.has("field.review"));
  const countries = callingCodeOptions().map((c) => ({ code: c.code, label: c.label }));
  const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Field visits" subtitle={profile.productId ? `${profile.productName}: ${profile.businessLabel ?? "businesses"}. Log every visit, whatever happened.` : "Log the businesses you visit."} actions={<Link className="btn-ghost" href="/leads/prospector/mine">My Prospects</Link>} />

      {!profile.productId && <Notice kind="error">You are not on a product yet. Ask your sales manager to put you on one (Field Sales Team), then come back here.</Notice>}
      {profile.productId && profile.kind !== "FIELD" && !user.permissions.has("field.review") && <Notice kind="error">Your profile is set to office work. Ask your sales manager to mark you as a field agent to log visits.</Notice>}

      <FieldCapture
        ready={ready} countries={countries} defaultCountry={policy.defaultCountry} productName={profile.productName} businessLabel={profile.businessLabel}
        serverCount={today.count} target={today.target}
        revisits={revisits.map((r) => ({ id: r.id, name: r.name, phone: r.phone, address: r.address, contactName: r.contactName, lastOutcome: r.lastOutcome, lastVisitAt: r.lastVisitAt ? time(r.lastVisitAt) : null }))}
      />

      {demos.length > 0 && (
        <section className="space-y-2" aria-labelledby="demos-h">
          <h2 id="demos-h" className="font-semibold">Demos <span className="text-sm font-normal text-muted">({demos.length})</span></h2>
          <ul className="card !p-0 divide-y divide-border">{demos.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0"><p className="truncate font-medium">{d.prospect.name}</p><p className="text-xs text-muted">{d.status === "SCHEDULED" && d.scheduledAt ? `Demo ${when(d.scheduledAt)}${d.mode ? `, ${DEMO_MODE_LABEL[d.mode as DemoMode]?.toLowerCase() ?? ""}` : ""}` : `Asked ${d.requestedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: zone })} · waiting for the onboarding team`}</p></div>
              {d.status === "SCHEDULED" && d.leadId ? <Link className="btn-ghost shrink-0" href={`/leads/${d.leadId}`}>Open lead</Link> : <Badge tone="warning">Requested</Badge>}
            </li>
          ))}</ul>
        </section>
      )}

      <section className="space-y-2" aria-labelledby="today-h">
        <h2 id="today-h" className="font-semibold">Sent today <span className="text-sm font-normal text-muted">({visits.length})</span></h2>
        {visits.length === 0 ? <p className="card text-sm text-muted">Nothing sent yet today. Visits you save appear here once they reach the server.</p> : (
          <ul className="card !p-0 divide-y divide-border">{visits.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0"><p className="truncate font-medium">{v.prospect.name}</p><p className="text-xs text-muted">{time(v.visitedAt)} · {v.photos} photo{v.photos === 1 ? "" : "s"}{v.locationSource === "NONE" ? " · no location" : ""}{v.needsDetails ? " · needs a phone or email" : ""}</p></div>
              <Badge tone={v.outcome === "INTERESTED" || v.outcome === "DEMO_REQUESTED" ? "success" : v.outcome === "NOT_INTERESTED" ? "danger" : "neutral"}>{LAST_OUTCOME_LABEL[v.outcome] ?? v.outcome}</Badge>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
