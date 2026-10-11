import Image from "next/image";
import { redirect } from "next/navigation";
import Room from "@/components/meeting/Room";
import { db } from "@/lib/db";
import { readTicket, setTicket } from "@/lib/meeting-cookie";
import { MeetingError, authenticateParticipant, joinAsGuest } from "@/lib/meetings";
import { limiter } from "@/lib/rate-limit";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join meeting" };

async function enter(formData: FormData) {
  "use server";
  const tokenValue = String(formData.get("token") ?? "");
  const ip = ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!limiter("guest-join", 20, 600_000).take(ip)) redirect(`/join/${tokenValue}?error=${encodeURIComponent("Too many attempts. Please wait a few minutes.")}`);
  try {
    const { meeting, participant } = await joinAsGuest(db, { joinToken: tokenValue, name: String(formData.get("name") ?? "") });
    await setTicket(meeting.id, participant.ticket);
  } catch (e) {
    if (e instanceof MeetingError) redirect(`/join/${tokenValue}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/join/${tokenValue}`);
}

// The guest entrance: no account, no sign-in. The secret in the address lets someone ask to join; the host decides who comes in.
export default async function Join({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; fake?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const m = /^[0-9a-f]{32}$/.test(token) ? await db.meeting.findUnique({ where: { joinToken: token } }) : null;
  if (!m || !(m.status === "SCHEDULED" || m.status === "LIVE")) {
    return <main className="grid min-h-screen place-items-center p-6"><div className="max-w-sm space-y-2 text-center"><h1 className="text-xl font-semibold">This meeting link is no longer valid</h1><p className="text-sm text-muted">The meeting may have ended or been cancelled. Ask the host for a new link.</p></div></main>;
  }
  const me = await authenticateParticipant(db, m.id, await readTicket(m.id));
  if (me && me.meetingId === m.id) {
    return <Room meetingId={m.id} title={m.title} kind={m.kind} me={{ name: me.name, isHost: false }} fake={sp.fake === "1"} />;
  }
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form action={enter} className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3"><Image src="/logo.png" alt="" width={36} height={36} className="rounded-lg" /><span className="font-semibold">Hifi Marketing and Technologies</span></div>
        <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{m.kind === "WORKSHOP" ? "Online workshop" : "Meeting"}</p><h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1></div>
        {sp.error && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{sp.error}</p>}
        <input type="hidden" name="token" value={token} />
        <div><label className="label" htmlFor="name">Your name</label><input id="name" name="name" required minLength={2} maxLength={40} autoComplete="name" className="input" /></div>
        <button className="btn w-full !py-2.5">Ask to join</button>
        <p className="text-xs text-muted">You will check your camera and microphone next. The host lets you in. No account is needed.</p>
      </form>
    </main>
  );
}
