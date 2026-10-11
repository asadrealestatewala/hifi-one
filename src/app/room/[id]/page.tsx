import { notFound } from "next/navigation";
import Room from "@/components/meeting/Room";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { baseUrl, readTicket } from "@/lib/meeting-cookie";
import { authenticateParticipant, guestLink } from "@/lib/meetings";
import { enterRoomAction } from "@/app/(app)/meetings/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meeting" };

// The staff entrance to a meeting room. It sits outside the normal page frame so the call can use the whole window.
export default async function StaffRoom({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fake?: string }> }) {
  const user = await requirePermission("meetings.use");
  const { id } = await params;
  const sp = await searchParams;
  const m = await db.meeting.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!m) notFound();
  const me = await authenticateParticipant(db, id, await readTicket(id));
  if (!me || me.userId !== user.id || me.status !== "ADMITTED") {
    return (
      <main className="mx-auto max-w-md space-y-4 p-10 text-center">
        <h1 className="text-xl font-semibold">{m.title}</h1>
        <form action={enterRoomAction}><input type="hidden" name="id" value={id} /><button className="btn">Enter the room as {user.name}</button></form>
      </main>
    );
  }
  const isHost = me.isHost || m.hostId === user.id;
  return <Room meetingId={id} title={m.title} kind={m.kind} me={{ name: me.name, isHost }} inviteUrl={guestLink(await baseUrl(), m.joinToken)} fake={sp.fake === "1"} />;
}
