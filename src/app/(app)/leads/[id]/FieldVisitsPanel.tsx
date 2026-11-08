import { toFileActor, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadFieldVisits } from "@/lib/demo-bookings";
import { LAST_OUTCOME_LABEL } from "@/lib/field-visits";
import { listFiles, signDownload } from "@/lib/files";
import { Badge } from "@/components/ui";

// What the field agent saw at the business before it became a lead (decision 73): each visit with its outcome, reason and photos.
// Photos are the visit's files (ownerType PROSPECT_VISIT); the list respects the file rules, so a reader without the right sees none.
export default async function FieldVisitsPanel({ user, leadId, zone }: { user: SessionUser; leadId: string; zone?: string }) {
  const visits = await leadFieldVisits(db, user.organizationId, leadId);
  if (visits.length === 0) return null;
  const actor = toFileActor(user);
  const secret = process.env.SESSION_SECRET ?? "";
  const files = await Promise.all(visits.map((v) => listFiles(db, actor, "PROSPECT_VISIT", v.id)));
  const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: zone });
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Field visits <span className="text-sm font-normal text-muted">({visits.length})</span></h2>
      <ul className="divide-y divide-border">
        {visits.map((v, i) => {
          const maps = v.lat !== null && v.lng !== null ? `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}` : null;
          return (
            <li key={v.id} className="space-y-2 py-3 first:pt-0 last:pb-0 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p><span className="font-medium">{when(v.visitedAt)}</span> <span className="text-muted">· {v.agentName}{maps ? <> · <a className="underline" href={maps} target="_blank" rel="noreferrer">Map</a></> : " · no location"}</span></p>
                <Badge tone={v.outcome === "INTERESTED" || v.outcome === "DEMO_REQUESTED" ? "success" : v.outcome === "NOT_INTERESTED" ? "danger" : "neutral"}>{LAST_OUTCOME_LABEL[v.outcome] ?? v.outcome}</Badge>
              </div>
              {(v.reason || v.note) && <p>{[v.reason, v.note].filter(Boolean).join(". ")}</p>}
              {files[i].length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {files[i].map((f) => {
                    const link = `/api/files/${f.id}?t=${signDownload(f.id, user.id, secret)}`;
                    const image = f.contentType.startsWith("image/");
                    return (
                      <li key={f.id}>
                        <a href={link} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border" title={`${f.category === "VISITING_CARD" ? "Visiting card" : "Premises"}: ${f.filename}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {image ? <img src={link} alt={f.category === "VISITING_CARD" ? "Visiting card" : "Business premises"} className="h-24 w-24 object-cover" loading="lazy" /> : <span className="flex h-24 w-24 items-center justify-center px-2 text-center text-xs">{f.filename}</span>}
                        </a>
                        <p className="mt-0.5 text-center text-[11px] text-muted">{f.category === "VISITING_CARD" ? "Visiting card" : "Premises"}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
