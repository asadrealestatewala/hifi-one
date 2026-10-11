import Link from "next/link";
import { Badge } from "@/components/ui";
import UtcDateTimeInput from "@/components/meeting/UtcDateTimeInput";
import { db } from "@/lib/db";
import { createMeetingAction, enterRoomAction } from "../../meetings/actions";

// Meetings and online workshops tied to this project. The client linked to the project is attached automatically.
export default async function ProjectMeetings({ projectId, organizationId, closed }: { projectId: string; organizationId: string; closed: boolean }) {
  const meetings = await db.meeting.findMany({ where: { organizationId, projectId }, orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }], take: 20 });
  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Meetings & workshops</h2><Link href="/meetings" className="text-xs text-muted hover:underline">All meetings</Link></div>
      {meetings.length === 0 ? <p className="text-sm text-muted">No meetings for this project yet.</p> : (
        <ul className="text-sm">
          {meetings.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-0">
              <span><Link className="font-medium hover:underline" href={`/meetings/${m.id}`}>{m.title}</Link> <Badge tone={m.status === "LIVE" ? "success" : m.status === "SCHEDULED" ? "primary" : "neutral"}>{m.status.toLowerCase()}</Badge>{m.kind === "WORKSHOP" && <span className="ml-1"><Badge tone="warning">workshop</Badge></span>}<span className="block text-xs text-muted">{m.scheduledAt ? m.scheduledAt.toLocaleString() : "Instant"}</span></span>
              {(m.status === "LIVE" || m.status === "SCHEDULED") && <form action={enterRoomAction}><input type="hidden" name="id" value={m.id} /><button className="btn-ghost">{m.status === "LIVE" ? "Join" : "Start"}</button></form>}
            </li>
          ))}
        </ul>
      )}
      {!closed && (
        <form action={createMeetingAction} className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="returnTo" value={`/projects/${projectId}`} /><input type="hidden" name="waitingRoom" value="on" />
          <div className="sm:col-span-2"><label className="label" htmlFor="pm-title">Schedule a meeting or workshop</label><input id="pm-title" name="title" required maxLength={140} className="input" placeholder="e.g. Kickoff workshop with the client" /></div>
          <div><label className="label" htmlFor="pm-kind">Type</label><select id="pm-kind" name="kind" className="input"><option value="MEETING">Meeting</option><option value="WORKSHOP">Online workshop</option></select></div>
          <UtcDateTimeInput id="pm-when" name="scheduledAt" label="When (empty = start now)" />
          <div className="flex items-end sm:col-span-2"><button className="btn">Create and get the guest link</button></div>
        </form>
      )}
    </section>
  );
}
