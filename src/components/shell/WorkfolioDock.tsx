"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State = { available: boolean; hidden?: boolean; reason: string | null; intervalMin: number; onBreak: boolean; inWorkingHours: boolean; nextDueAt: string | null };

const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

// Workfolio screen sharing. The person starts it themselves: the browser asks which screen or window to share and shows its own
// "sharing" indicator, and this pill stays visible on every screen while it runs. While they are clocked in, working hours apply
// and they are not on a break, a snapshot of the shared screen is saved every interval. Stopping the share, a break or clocking
// out ends capture at once. Nothing is recorded unless the person is sharing.
export default function WorkfolioDock() {
  const [st, setSt] = useState<State | null>(null);
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const due = useRef<number>(0);
  const busy = useRef(false);
  // Live view (a manager watching the shared screen, only after the person accepts).
  const [ask, setAsk] = useState<{ id: string; viewerName: string } | null>(null);
  const [watcher, setWatcher] = useState<{ id: string; viewerName: string } | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const ice = useRef<RTCIceServer[]>([]);
  const askRef = useRef<{ id: string; viewerName: string } | null>(null);
  const watchRef = useRef<{ id: string; viewerName: string } | null>(null);
  askRef.current = ask; watchRef.current = watcher;
  const post = useCallback((body: unknown) => fetch("/api/monitor/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined), []);
  const closeLive = useCallback(() => { pc.current?.close(); pc.current = null; setWatcher(null); setAsk(null); }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/monitor/state", { cache: "no-store" });
      const s = (await r.json()) as State;
      setSt(s);
      due.current = s.nextDueAt ? Date.parse(s.nextDueAt) : 0;
      if (!s.available && stream.current) stop(); // clocked out or policy changed
    } catch { /* offline: keep the last state */ }
  }, []);

  function stop() {
    if (watchRef.current) void post({ op: "end", id: watchRef.current.id });
    closeLive();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null; setSharing(false);
  }

  const available = !!st?.available;
  useEffect(() => {
    if (!available) return;
    const src = new EventSource("/api/monitor/live");
    const on = <T,>(name: string, fn: (d: T) => void) => src.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data) as T));
    on<{ iceServers: RTCIceServer[] }>("hello", (d) => { ice.current = d.iceServers; });
    on<{ id: string; viewerName: string; seconds: number }>("request", (d) => { setAsk({ id: d.id, viewerName: d.viewerName }); setTimeout(() => setAsk((a) => (a?.id === d.id ? null : a)), d.seconds * 1000); });
    on<{ id: string }>("ended", (d) => { if (watchRef.current?.id === d.id || askRef.current?.id === d.id) closeLive(); });
    on<{ id: string; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }>("signal", async ({ id, data }) => {
      const conn = pc.current;
      if (!conn || watchRef.current?.id !== id) return;
      if (data.sdp) {
        await conn.setRemoteDescription(data.sdp);
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        void post({ op: "signal", id, data: { sdp: conn.localDescription } });
      } else if (data.candidate) await conn.addIceCandidate(data.candidate).catch(() => undefined);
    });
    return () => src.close();
  }, [available, closeLive, post]);
  useEffect(() => { if (!st?.available || st.onBreak || !st.inWorkingHours) { if (watchRef.current) { void post({ op: "end", id: watchRef.current.id }); closeLive(); } } }, [st, closeLive, post]);

  async function accept(a: { id: string; viewerName: string }) {
    if (!stream.current) await start(); // the person chooses what to share first; the browser shows its own indicator
    if (!stream.current) { void post({ op: "respond", id: a.id, accept: false }); setAsk(null); return; }
    const conn = new RTCPeerConnection({ iceServers: ice.current });
    stream.current.getVideoTracks().forEach((t) => conn.addTrack(t, stream.current!));
    conn.onicecandidate = (e) => { if (e.candidate) void post({ op: "signal", id: a.id, data: { candidate: e.candidate.toJSON() } }); };
    conn.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(conn.connectionState) && pc.current === conn) { void post({ op: "end", id: a.id }); closeLive(); } };
    pc.current = conn;
    setWatcher(a); setAsk(null);
    await post({ op: "respond", id: a.id, accept: true });
  }
  function decline(a: { id: string }) { void post({ op: "respond", id: a.id, accept: false }); setAsk(null); }

  useEffect(() => { void refresh(); const t = setInterval(refresh, 60_000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  const capture = useCallback(async () => {
    const v = video.current;
    if (!v || !stream.current || busy.current || v.videoWidth === 0) return;
    busy.current = true;
    try {
      const scale = Math.min(1, 1600 / v.videoWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      let blob: Blob | null = null;
      for (const q of [0.7, 0.5, 0.35]) { blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", q)); if (blob && blob.size <= 1_400_000) break; }
      if (!blob) return;
      const r = await fetch("/api/monitor/snapshot", { method: "POST", body: blob, headers: { "content-type": "image/jpeg" } });
      if (r.ok) setNote(null);
      else { const j = await r.json().catch(() => ({})); setNote((j as { error?: string }).error ?? "Snapshot not saved."); }
    } finally { busy.current = false; void refresh(); }
  }, [refresh]);

  // The check runs every few seconds; the server decides whether the snapshot is accepted.
  useEffect(() => {
    if (!sharing || !st?.available || st.onBreak || !st.inWorkingHours) return;
    const t = setInterval(() => { if (Date.now() >= due.current) { due.current = Date.now() + st.intervalMin * 60_000; void capture(); } }, 5000);
    return () => clearInterval(t);
  }, [sharing, st, capture]);

  async function start() {
    setNote(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
      stream.current = s;
      const v = video.current!;
      v.srcObject = s; await v.play();
      s.getVideoTracks()[0].addEventListener("ended", () => { stream.current = null; setSharing(false); });
      setSharing(true);
      due.current = Math.max(Date.now() + 3000, due.current || 0);
    } catch {
      setNote("Sharing was not started. Choose a screen or window to share when your browser asks.");
    }
  }

  if (!st || st.hidden) return null;
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  const show = sharing || st.available;
  if (!show) return null;
  const remaining = due.current - now;
  return (
    <div className="fixed bottom-5 left-5 z-40 max-w-xs md:left-[19rem] print:hidden" role="status" aria-live="polite">
      <video ref={video} className="hidden" muted playsInline />
      {ask && (
        <div className="mb-2 rounded-2xl border border-brand bg-surface p-3 text-sm shadow-lg" role="alertdialog" aria-label="Live view request">
          <p className="font-medium">{ask.viewerName} would like to watch your screen live</p>
          <p className="mt-1 text-xs text-muted">If you agree, they see only the screen or window you are sharing, for as long as you allow. A banner stays on your screen the whole time, you can stop at any time, and this is recorded where you can read it. Saying no has no consequences.</p>
          <div className="mt-2 flex gap-2"><button type="button" onClick={() => void accept(ask)} className="btn !py-1 text-xs">Allow</button><button type="button" onClick={() => decline(ask)} className="btn-ghost !py-1 text-xs">No thanks</button></div>
        </div>
      )}
      {watcher && (
        <div className="mb-2 rounded-2xl border-2 border-danger bg-surface p-3 text-sm shadow-lg" role="alert">
          <p className="flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden />{watcher.viewerName} is watching your shared screen live</p>
          <button type="button" onClick={() => { void post({ op: "end", id: watcher.id }); closeLive(); }} className="btn-ghost mt-2 !py-1 text-xs">Stop now</button>
        </div>
      )}
      {sharing ? (
        <div className="rounded-2xl border border-brand/40 bg-surface p-3 text-sm shadow-lg">
          <p className="flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" aria-hidden />Workfolio is capturing your screen</p>
          <p className="mt-1 text-xs text-muted">
            {st.onBreak ? "On a break: nothing is captured." : !st.inWorkingHours ? "Outside working hours: nothing is captured." : `Next snapshot in ${mmss(remaining)} (every ${st.intervalMin} min).`}
          </p>
          <button type="button" onClick={stop} className="btn-ghost mt-2 !py-1 text-xs">Stop sharing</button>
          {note && <p className="mt-1 text-xs text-brand">{note}</p>}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-3 text-sm shadow-lg">
          <p className="font-medium">Workfolio: start screen sharing</p>
          <p className="mt-1 text-xs text-muted">{supported ? `You are clocked in. While you share, a snapshot is saved every ${st.intervalMin} minutes. You can stop at any time.` : "This browser cannot share a screen. Use Chrome, Edge or Firefox on a computer."}</p>
          {supported && <button type="button" onClick={start} className="btn mt-2 !py-1 text-xs">Share my screen</button>}
          {note && <p className="mt-1 text-xs text-brand">{note}</p>}
        </div>
      )}
    </div>
  );
}
