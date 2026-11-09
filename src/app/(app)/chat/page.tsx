import { requirePermission } from "@/lib/auth";
import ChatApp from "./ChatApp";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  const user = await requirePermission("chat.use");
  const sp = await searchParams;
  return <ChatApp meId={user.id} meName={user.name} initialRoom={sp.room ?? null} canCall={user.permissions.has("meetings.use")} />;
}
