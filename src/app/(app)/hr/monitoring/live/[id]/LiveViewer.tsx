"use client";

import { useEffect, useRef, useState } from "react";

// The manager's side. Nothing starts until the person accepts; the video arrives straight from their browser.
export default function LiveViewer({ subjectId, name, support = false, deviceId }: { subjectId: string; name: string; support?: boolean; deviceId?: string }) {
  const [why, setWhy] = useState("");
  const [status, setStatus] = useState<string>("Not started.");
  const [running, setRunning] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const reqId = useRef<string | null>(null);
  const ice = useRef<RTCIceServer[]>([]);
  const src = useRef<EventSource | null>(null);

  const post = (body: unknown) => fetch("/api/monitor/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  function cleanup(msg: string) {
    pc.current?.close(); pc.current = null; src.current?.close(); src.current = null; reqId.current = null;
    if (video.current) video.current.srcObject = null;
    setRunning(false); setStatus(msg);
  }
  useEffect(() => () => { if (reqId.current) void post({ op: "end", id: reqId.current }); pc.current?.close(); src.current?.close(); }, []);

  async function begin() {
    setStatus(`Asking ${name}…`);
    const es = new EventSource("/api/monitor/live");
    src.current = es;
    const on = <T,>(n: string, fn: (d: T) => void) => es.addEventListener(n, (e) => fn(JSON.parse((e as MessageEvent).data) as T));
    on<{ iceServers: RTCIceServer[] }>("hello", (d) => { ice.current = d.iceServers; });
    on<{ id: string; accepted: boolean }>("answered", async (d) => {
      if (d.id !== reqId.current) return;
      if (!d.accepted) return cleanup(`${name} said no. Nothing was shown.`);
      setStatus("Connecting…");
      const conn = new RTCPeerConnection({ iceServers: ice.current });
      pc.current = conn;
      conn.addTransceiver("video", { direction: "recvonly" });
      conn.ontrack = (e) => { if (video.current) { video.current.srcObject = e.streams[0] ?? new MediaStream([e.track]); void video.current.play().catch(() => undefined); } setRunning(true); setStatus(`Watching ${name}'s shared screen.`); };
      conn.onicecandidate = (e) => { if (e.candidate) void post({ op: "signal", id: d.id, data: { candidate: e.candidate.toJSON() } }); };
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      void post({ op: "signal", id: d.id, data: { sdp: conn.localDescription } });
    });
    on<{ id: string; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }>("signal", async ({ id, data }) => {
      const conn = pc.current;
      if (!conn || id !== reqId.current) return;
      if (data.sdp) await conn.setRemoteDescription(data.sdp);
      else if (data.candidate) await conn.addIceCandidate(data.candidate).catch(() => undefined);
    });
    on<{ id: string }>("ended", (d) => { if (d.id === reqId.current) cleanup("The live view ended."); });
    await new Promise((r) => setTimeout(r, 400)); // let the stream open before the answer can arrive
    const r = await post(deviceId ? { op: "request_phone", deviceId, reason: why } : { op: "request", subjectId, kind: support ? "SUPPORT" : "VIEW", reason: why });
    const j = (await r.json()) as { id?: string; error?: string };
    if (!r.ok || !j.id) return cleanup(j.error ?? "Could not ask.");
    reqId.current = j.id;
    setStatus(`Waiting for ${name} to answer (up to a minute)…`);
  }
  function stop() { if (reqId.current) void post({ op: "end", id: reqId.current }); cleanup("Stopped."); }

  return (
    <section className="card space-y-3">
      <video ref={video} className={`aspect-video w-full rounded-lg border border-border bg-black ${running ? "" : "hidden"}`} muted playsInline controls={false} />
      {support && !running && !src.current && <div><label className="label" htmlFor="why">Why do you want to help? They will read this before answering.</label><input id="why" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} className="input" placeholder="e.g. the invoice printer is not responding" /></div>}
      <p className="text-sm" role="status" aria-live="polite">{status}</p>
      <div className="flex gap-2">
        {!src.current && !running ? <button type="button" onClick={() => void begin()} className="btn">{support ? "Ask to help" : "Ask to watch"}</button> : <button type="button" onClick={stop} className="btn-ghost">Stop watching</button>}
      </div>
    </section>
  );
}
