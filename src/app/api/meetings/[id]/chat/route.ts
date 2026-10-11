import { db } from "@/lib/db";
import { publish } from "@/lib/meeting-hub";
import { json, ticketFrom } from "@/lib/meeting-http";
import { authenticateParticipant, MeetingError, postMessage } from "@/lib/meetings";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// A chat message from an admitted participant, stored and sent to everyone in the call. Shown as plain text by the page.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = ticketFrom(req, id);
  const me = await authenticateParticipant(db, id, ticket);
  if (!me || me.status !== "ADMITTED") return json({ error: "Not found" }, 404);
  if (!limiter("meeting-chat", 30, 60_000).take(me.id)) return json({ error: "You are sending messages too fast." }, 429);
  const b = (await req.json().catch(() => ({}))) as { body?: string };
  try {
    const m = await postMessage(db, { meetingId: id, ticket: ticket!, body: String(b.body ?? "") });
    publish(id, "chat", m);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof MeetingError) return json({ error: e.message }, 400);
    throw e;
  }
}
