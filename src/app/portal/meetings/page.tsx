import { requireClientUser } from "@/lib/auth";
import { Badge, Empty } from "@/components/ui";
import { db } from "@/lib/db";
import { baseUrl } from "@/lib/meeting-cookie";
import { guestLink } from "@/lib/meetings";

export const dynamic = "force-dynamic";

// Meetings and workshops the company has linked to this client. Joining goes through the same guest link (and waiting room).
export default async function PortalMeetings() {
  const user = await requireClientUser();
  const meetings = await db.meeting.findMany({ where: { organizationId: user.organizationId, clientId: user.clientId, status: { in: ["SCHEDULED", "LIVE"] } }, orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }], take: 30 });
  const base = await baseUrl();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Meetings & workshops</h1>
      {meetings.length === 0 ? <Empty title="Nothing scheduled">When we invite you to a meeting or workshop it will appear here with a button to join.</Empty> : (
        <ul className="space-y-3">{meetings.map((m) => (
          <li key={m.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-medium">{m.title} {m.status === "LIVE" && <Badge tone="success">live now</Badge>}{m.kind === "WORKSHOP" && <span className="ml-1"><Badge tone="warning">workshop</Badge></span>}</p><p className="text-sm text-muted">{m.scheduledAt ? m.scheduledAt.toLocaleString() : "Starting now"} · {m.durationMin} minutes</p>{m.agenda && <p className="mt-1 whitespace-pre-line text-sm">{m.agenda}</p>}</div>
            <a className="btn" href={guestLink(base, m.joinToken)} target="_blank" rel="noopener">Join in your browser</a>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
