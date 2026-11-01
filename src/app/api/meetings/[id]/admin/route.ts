import { db } from "@/lib/db";
import { publish } from "@/lib/meeting-hub";
import { broadcastRoster, json, peersFor, ticketFrom } from "@/lib/meeting-http";
import { authenticateParticipant, decide, endMeeting, history, leave, MeetingError } from "@/lib/meetings";
import { closeForMeeting, isRecording } from "@/lib/recordings";

export const dynamic = "force-dynamic";

// Host controls: admit or deny someone waiting, remove someone, end the meeting for everyone.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = ticketFrom(req, id);
  const me = await authenticateParticipant(db, id, ticket);
  if (!me || me.status !== "ADMITTED") return json({ error: "Not found" }, 404);
  const b = (await req.json().catch(() => ({}))) as { action?: string; target?: string };
  try {
    if (b.action === "leave") {
      await leave(db, me.id);
      publish(id, "peer-left", { id: me.id }, { except: me.id });
      await broadcastRoster(id);
      return json({ ok: true });
    }
    if (b.action === "end") {
      await endMeeting(db, { meetingId: id, actorTicket: ticket! });
      await closeForMeeting(db, id); // nothing keeps recording after the meeting ends
      publish(id, "ended", {});
      return json({ ok: true });
    }
    const action = b.action === "admit" ? "ADMIT" : b.action === "deny" ? "DENY" : b.action === "remove" ? "REMOVE" : null;
    if (!action || !b.target) return json({ error: "Bad request" }, 400);
    await decide(db, { meetingId: id, actorTicket: ticket!, targetId: b.target, action });
    if (action === "ADMIT") publish(id, "admitted", { peers: await peersFor(id, b.target), messages: await history(db, id), recording: await isRecording(db, id) }, { to: b.target });
    else publish(id, action === "DENY" ? "denied" : "removed", {}, { to: b.target });
    await broadcastRoster(id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof MeetingError) return json({ error: e.message }, 400);
    throw e;
  }
}
