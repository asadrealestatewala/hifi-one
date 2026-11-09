"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import { subscribeChat } from "@/lib/chat-stream";

type Incoming = { messageId: string; roomId: string; callerId: string; callerName: string; mode: "audio" | "video"; group: boolean; roomName: string | null };

// Rings when a colleague calls, on any page. Answering opens the call room; declining tells the caller.
export default function CallListener({ meId }: { meId: string }) {
  const [ring, setRing] = useState<Incoming | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ringRef = useRef<Incoming | null>(null);
  ringRef.current = ring;

  useEffect(() => subscribeChat((event, data) => {
    if (event === "call") {
      const d = data as { message: { id: string; roomId: string; senderId: string }; callerName: string; mode: "audio" | "video"; group?: boolean; roomName?: string | null };
      if (d.message.senderId === meId) return;
      setErr(null);
      setRing({ messageId: d.message.id, roomId: d.message.roomId, callerId: d.message.senderId, callerName: d.callerName, mode: d.mode, group: !!d.group, roomName: d.roomName ?? null });
      if (document.visibilityState === "hidden" && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification(d.group ? `${d.callerName} started a group call` : `${d.callerName} is calling`, { body: d.group ? `${d.roomName ?? "Group"} · ${d.mode === "video" ? "video" : "voice"} call` : `Incoming ${d.mode === "video" ? "video" : "voice"} call`, tag: "hifi-call" }); } catch { /* not allowed here */ }
      }
    } else if (event === "call-update") {
      const d = data as { message: { id: string; body?: string } };
      if (ringRef.current?.messageId !== d.message.id) return;
      // Cancelled, answered on another device, or timed out. A group call someone else has answered can still be joined, so its ring stays.
      let status = "";
      try { status = (JSON.parse(d.message.body ?? "{}") as { status?: string }).status ?? ""; } catch { /* treat as ended */ }
      if (!ringRef.current.group || status !== "ANSWERED") setRing(null);
    }
  }), [meId]);

  // A short repeating ring made with the browser's own audio (no sound file). Browsers may stay silent until the page has been clicked.
  useEffect(() => {
    if (!ring) return;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    try {
      ctx = new AudioContext();
      const beep = () => {
        if (!ctx) return;
        for (const [t, f] of [[0, 880], [0.25, 660]] as const) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = f; g.gain.value = 0.08;
          o.connect(g).connect(ctx.destination);
          o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18);
        }
      };
      void ctx.resume().catch(() => {});
      beep(); timer = setInterval(beep, 2000);
    } catch { /* silent ring: the screen still shows the call */ }
    const gone = setTimeout(() => setRing(null), 50_000);
    return () => { if (timer) clearInterval(timer); clearTimeout(gone); void ctx?.close().catch(() => {}); };
  }, [ring]);

  if (!ring) return null;
  const act = async (action: "answer" | "decline") => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/chat/calls/${ring.messageId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const d = (await res.json().catch(() => ({}))) as { roomUrl?: string; error?: string };
      if (!res.ok) { setErr(d.error ?? "Could not answer the call."); setBusy(false); if (action === "answer") setTimeout(() => setRing(null), 2500); return; }
      if (action === "answer" && d.roomUrl) { window.location.href = d.roomUrl; return; }
      setRing(null);
    } catch { setErr("Could not reach the server. Try again."); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-x-3 top-3 z-[60] mx-auto max-w-sm rounded-2xl border border-border bg-surface p-4 shadow-2xl sm:left-auto sm:right-4 sm:mx-0" role="alertdialog" aria-label={ring.group ? `Group call in ${ring.roomName ?? "a group"} from ${ring.callerName}` : `Incoming call from ${ring.callerName}`}>
      <div className="flex items-center gap-3">
        <span className="relative"><Avatar name={ring.callerName} userId={ring.callerId} size={48} /><span className="absolute inset-0 animate-ping rounded-full ring-2 ring-success/60" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{ring.group ? ring.roomName ?? "Group call" : ring.callerName}</p>
          <p className="text-sm text-muted">{ring.group ? `${ring.callerName} started a group ${ring.mode === "video" ? "video" : "voice"} call…` : `Incoming ${ring.mode === "video" ? "video" : "voice"} call…`}</p>
        </div>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-brand">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-ghost flex-1 !text-brand" disabled={busy} onClick={() => void act("decline")}>Decline</button>
        <button className="btn flex-1" disabled={busy} onClick={() => void act("answer")}>{busy ? "Connecting…" : ring.group ? "Join" : "Answer"}</button>
      </div>
    </div>
  );
}
