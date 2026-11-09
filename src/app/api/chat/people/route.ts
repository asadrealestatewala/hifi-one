import { requirePermission } from "@/lib/auth";
import { searchPeople } from "@/lib/chat";
import { chatFail, staffOnly, noStore, toChatActor } from "@/lib/chat-http";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return user;
  const denied = staffOnly(user);
  if (denied) return denied;
  try {
    return Response.json({ people: await searchPeople(db, toChatActor(user), new URL(req.url).searchParams.get("q") ?? "") }, { headers: noStore });
  } catch (e) { return chatFail(e); }
}
