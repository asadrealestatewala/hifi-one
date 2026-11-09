import { requirePermission } from "@/lib/auth";
import { addMembers, memberIds, removeMember, renameGroup, setMuted } from "@/lib/chat";
import { publishTo } from "@/lib/chat-hub";
import { chatFail, staffOnly, noStore, toChatActor } from "@/lib/chat-http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Body: { action: "add", userIds } | { action: "remove", userId } (own id = leave) | { action: "rename", name } | { action: "mute", muted }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { action?: string; userIds?: string[]; userId?: string; name?: string; muted?: boolean } | null;
  if (!b) return Response.json({ error: "Bad request." }, { status: 400 });
  const actor = toChatActor(user);
  try {
    const before = await memberIds(db, id);
    if (b.action === "add") await addMembers(db, actor, id, Array.isArray(b.userIds) ? b.userIds.map(String) : []);
    else if (b.action === "remove") await removeMember(db, actor, id, String(b.userId ?? ""));
    else if (b.action === "rename") await renameGroup(db, actor, id, String(b.name ?? ""));
    else if (b.action === "mute") { await setMuted(db, actor, id, !!b.muted); return Response.json({ ok: true }, { headers: noStore }); }
    else return Response.json({ error: "Bad request." }, { status: 400 });
    publishTo([...before, ...(await memberIds(db, id))], "room", { roomId: id });
    return Response.json({ ok: true }, { headers: noStore });
  } catch (e) { return chatFail(e); }
}
