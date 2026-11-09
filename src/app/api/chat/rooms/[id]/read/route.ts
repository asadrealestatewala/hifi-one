import { requirePermission } from "@/lib/auth";
import { markRead } from "@/lib/chat";
import { publishTo } from "@/lib/chat-hub";
import { chatFail, staffOnly, noStore, toChatActor } from "@/lib/chat-http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { at, recipients } = await markRead(db, toChatActor(user), id);
    publishTo(recipients, "read", { roomId: id, userId: user.id, at });
    return Response.json({ ok: true }, { headers: noStore });
  } catch (e) { return chatFail(e); }
}
