import { MEETING_PURPOSES, PURPOSE_LABEL } from "@/lib/delivery";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { Badge, Empty, Notice, PageHeader } from "@/components/ui";
import UtcDateTimeInput from "@/components/meeting/UtcDateTimeInput";
import { db } from "@/lib/db";
import { createMeetingAction, enterRoomAction } from "./actions";

export const dynamic = "force-dynamic";
const TONE = { LIVE: "success", SCHEDULED: "primary", ENDED: "neutral", CANCELLED: "danger" } as const;

export default async function Meetings({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("meetings.use");
  const sp = await searchParams;
  const org = user.organizationId;
  const [meetings, projects, clients] = await Promise.all([
    db.meeting.findMany({ where: { organizationId: org }, orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }], take: 60 }),
    db.project.findMany({ where: { organizationId: org, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const live = meetings.filter((m) => m.status === "LIVE");
  const upcoming = meetings.filter((m) => m.status === "SCHEDULED").sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
  const past = meetings.filter((m) => m.status === "ENDED" || m.status === "CANCELLED");
  const row = (m: (typeof meetings)[number], join: boolean) => (
    <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-0">
      <div className="min-w-0">
        <Link href={`/meetings/${m.id}`} className="font-medium hover:underline">{m.title}</Link>{" "}
        <Badge tone={TONE[m.status as keyof typeof TONE] ?? "neutral"}>{m.status.toLowerCase()}</Badge>{m.kind === "WORKSHOP" && <span className="ml-1"><Badge tone="warning">workshop</Badge></span>}
        <p className="text-xs text-muted">{m.scheduledAt ? m.scheduledAt.toLocaleString() : "Instant"}{m.clientId && names.get(m.clientId) ? ` · ${names.get(m.clientId)}` : ""}</p>
      </div>
      {join && <form action={enterRoomAction}><input type="hidden" name="id" value={m.id} /><button className="btn">{m.status === "LIVE" ? "Join now" : "Start"}</button></form>}
    </li>
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Meetings & workshops" subtitle="Video calls with screen sharing and chat, right inside Hifi One. Share a link with a client: they join from their browser with no account, and wait until you let them in." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {live.length > 0 && <section className="card"><h2 className="mb-1 font-semibold">Live now</h2><ul>{live.map((m) => row(m, true))}</ul></section>}
          <section className="card"><h2 className="mb-1 font-semibold">Upcoming</h2>{upcoming.length === 0 ? <p className="text-sm text-muted">Nothing scheduled.</p> : <ul>{upcoming.map((m) => row(m, true))}</ul>}</section>
          <section className="card"><h2 className="mb-1 font-semibold">Past</h2>{past.length === 0 ? <Empty title="No past meetings" /> : <ul>{past.map((m) => row(m, false))}</ul>}</section>
        </div>
        <form action={createMeetingAction} className="card space-y-3 self-start">
          <h2 className="font-semibold">New meeting</h2>
          <div><label className="label" htmlFor="m-title">Title</label><input id="m-title" name="title" required maxLength={140} className="input" placeholder="e.g. Brand workshop with Acme" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="m-kind">Type</label><select id="m-kind" name="kind" className="input"><option value="MEETING">Meeting</option><option value="WORKSHOP">Online workshop</option></select></div>
            <div><label className="label" htmlFor="m-dur">Minutes</label><input id="m-dur" name="durationMin" type="number" min={5} max={480} defaultValue={60} className="input" /></div>
          </div>
          <div><label className="label" htmlFor="m-purpose">What is it for</label><select id="m-purpose" name="purpose" className="input" defaultValue="GENERAL">{MEETING_PURPOSES.map((x) => <option key={x} value={x}>{PURPOSE_LABEL[x]}</option>)}</select></div>
          <UtcDateTimeInput id="m-when" name="scheduledAt" label="When (leave empty to start now)" />
          <div><label className="label" htmlFor="m-client">Client (optional)</label><select id="m-client" name="clientId" className="input" defaultValue=""><option value="">None</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="m-proj">Project (optional)</label><select id="m-proj" name="projectId" className="input" defaultValue=""><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="label" htmlFor="m-ag">Agenda</label><textarea id="m-ag" name="agenda" rows={3} maxLength={4000} className="input" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="waitingRoom" defaultChecked /> Guests wait until I let them in</label>
          <button className="btn w-full">Create and get the link</button>
        </form>
      </div>
    </div>
  );
}
