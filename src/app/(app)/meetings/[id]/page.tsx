import Link from "next/link";
import { notFound } from "next/navigation";
import WhatsAppButton from "@/components/WhatsAppButton";
import { Badge, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { baseUrl } from "@/lib/meeting-cookie";
import { attendance, guestLink, history } from "@/lib/meetings";
import { cancelAction, emailInviteAction, enterRoomAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function MeetingDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("meetings.use");
  const { id } = await params;
  const sp = await searchParams;
  const m = await db.meeting.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!m) notFound();
  const [host, client, project, att, chat] = await Promise.all([
    db.user.findUnique({ where: { id: m.hostId }, select: { name: true } }),
    m.clientId ? db.client.findUnique({ where: { id: m.clientId }, select: { name: true, email: true, phone: true } }) : null,
    m.projectId ? db.project.findUnique({ where: { id: m.projectId }, select: { id: true, name: true } }) : null,
    attendance(db, m.id),
    history(db, m.id, 500),
  ]);
  const link = guestLink(await baseUrl(), m.joinToken);
  const open = m.status === "SCHEDULED" || m.status === "LIVE";
  const isHost = m.hostId === user.id;
  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/meetings" className="text-sm text-muted hover:underline">← Meetings</Link>
      <PageHeader title={m.title} subtitle={<>{m.kind === "WORKSHOP" ? "Online workshop" : "Meeting"} · hosted by {host?.name}{m.scheduledAt && ` · ${m.scheduledAt.toLocaleString()} (${m.durationMin} min)`}{client && ` · ${client.name}`}{project && <> · <Link className="underline" href={`/projects/${project.id}`}>{project.name}</Link></>}</>}
        actions={<><Badge tone={m.status === "LIVE" ? "success" : m.status === "SCHEDULED" ? "primary" : "neutral"}>{m.status.toLowerCase()}</Badge>{open && <form action={enterRoomAction}><input type="hidden" name="id" value={m.id} /><button className="btn">{m.status === "LIVE" ? "Join now" : "Start the meeting"}</button></form>}</>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {m.agenda && <section className="card"><h2 className="mb-1 font-semibold">Agenda</h2><p className="whitespace-pre-line text-sm">{m.agenda}</p></section>}

      {open && (
        <section className="card space-y-4">
          <div>
            <h2 className="font-semibold">Guest link</h2>
            <p className="text-xs text-muted">Anyone with this link can ask to join from their browser{m.waitingRoom ? " and will wait until you admit them" : ""}. The link stops working when the meeting ends.</p>
            <input readOnly value={link} aria-label="Guest link" className="input mt-2 font-mono text-xs" onFocus={undefined} />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <form action={emailInviteAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={m.id} />
              <div><label className="label" htmlFor="inv-to">Email the invitation to</label><input id="inv-to" name="to" type="email" required defaultValue={client?.email ?? ""} className="input !w-72" placeholder="client@example.com" /></div>
              <button className="btn-ghost">Send email</button>
            </form>
            {client?.phone && <WhatsAppButton phone={client.phone} text={`Hello, you are invited to "${m.title}" ${m.scheduledAt ? `on ${m.scheduledAt.toUTCString()}` : "now"}. Join from your browser: ${link}`} label="Invite on WhatsApp" />}
          </div>
        </section>
      )}

      {isHost && m.status === "SCHEDULED" && <form action={cancelAction}><input type="hidden" name="id" value={m.id} /><button className="btn-ghost">Cancel this meeting</button></form>}

      {att.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Attendance</h2>
          <table className="w-full text-sm"><thead className="text-left"><tr><th className="py-2 pr-4">Name</th><th className="pr-4">Joined</th><th className="pr-4">Left</th><th className="pr-4 text-right">Minutes</th></tr></thead>
            <tbody>{att.map((a, i) => <tr key={i} className="border-t border-border transition hover:bg-hover/50"><td className="py-2 pr-4">{a.name}{a.host && <span className="ml-1"><Badge tone="primary">host</Badge></span>}{!a.staff && <span className="ml-1"><Badge>guest</Badge></span>}</td><td className="pr-4">{a.from.toLocaleTimeString()}</td><td className="pr-4">{a.to ? a.to.toLocaleTimeString() : "still in"}</td><td className="pr-4 text-right">{a.minutes}</td></tr>)}</tbody></table>
        </section>
      )}
      {chat.length > 0 && (
        <section className="card"><h2 className="mb-2 font-semibold">Chat transcript</h2><ol className="space-y-2 text-sm">{chat.map((c) => <li key={c.id}><span className="text-xs text-muted">{c.authorName} · {new Date(c.at).toLocaleTimeString()}</span><p className="whitespace-pre-wrap">{c.body}</p></li>)}</ol></section>
      )}
    </div>
  );
}
