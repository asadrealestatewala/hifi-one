import { requirePermission } from "@/lib/auth";
import { createGroup, listRooms, openDirect, syncProjectRooms } from "@/lib/chat";
import { publishTo } from "@/lib/chat-hub";
import { chatFail, staffOnly, noStore, toChatActor } from "@/lib/chat-http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  try {
    const actor = toChatActor(user);
    await syncProjectRooms(db, actor);
    return Response.json({ rooms: await listRooms(db, actor) }, { headers: noStore });
  } catch (e) { return chatFail(e); }
}

// Body: { kind: "direct", userId } or { kind: "group", name, memberIds }
export async function POST(req: Request) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  try {
    const actor = toChatActor(user);
    const b = (await req.json().catch(() => null)) as { kind?: string; userId?: string; name?: string; memberIds?: string[] } | null;
    if (!b) return Response.json({ error: "Bad request." }, { status: 400 });
    if (b.kind === "direct") {
      const room = await openDirect(db, actor, String(b.userId ?? ""));
      return Response.json({ roomId: room.id }, { headers: noStore });
    }
    if (b.kind === "group") {
      const room = await createGroup(db, actor, { name: String(b.name ?? ""), memberIds: Array.isArray(b.memberIds) ? b.memberIds.map(String) : [] });
      const members = (await db.chatMember.findMany({ where: { roomId: room.id }, select: { userId: true } })).map((m) => m.userId);
      publishTo(members, "room", { roomId: room.id });
      return Response.json({ roomId: room.id }, { headers: noStore });
    }
    return Response.json({ error: "Bad request." }, { status: 400 });
  } catch (e) { return chatFail(e); }
}
