import { requirePermission } from "@/lib/auth";
import { deleteMessage } from "@/lib/chat";
import { publishTo } from "@/lib/chat-hub";
import { chatFail, staffOnly, noStore, toChatActor } from "@/lib/chat-http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Delete your own message (it stays in the conversation as "This message was deleted").
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  const { id } = await params;
  try {
    const { roomId, recipients } = await deleteMessage(db, toChatActor(user), id);
    publishTo(recipients, "deleted", { roomId, messageId: id });
    return Response.json({ ok: true }, { headers: noStore });
  } catch (e) { return chatFail(e); }
}
