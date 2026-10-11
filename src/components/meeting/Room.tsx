"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/shell/Icon";

// A small peer-to-peer video room (WebRTC). Everyone sends audio, camera and screen straight to everyone else; the server only
// passes the handshake messages and chat. Each connection has three fixed lanes (microphone, camera, screen), so turning the
// camera or sharing the screen swaps what a lane carries without renegotiating the call.
type Person = { id: string; name: string; isHost: boolean; online: boolean };
type Msg = { id: string; participantId: string; authorName: string; body: string; at: string };
type PeerState = { muted: boolean; camOff: boolean; sharing: boolean };
type Peer = {
  pc: RTCPeerConnection; initiator: boolean; name: string; cam: MediaStream | null; screen: MediaStream | null; audio: MediaStream | null;
  pending: RTCIceCandidateInit[]; state: PeerState;
};
type Phase = "prejoin" | "connecting" | "waiting" | "live" | "ended" | "denied" | "removed";
const LANES = ["audio", "cam", "screen"] as const;

function fakeStream(label: string, kind: "cam" | "screen"): MediaStream {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 360;
  const ctx = c.getContext("2d")!;
  const draw = () => { ctx.fillStyle = kind === "screen" ? "#0f766e" : "#4f46e5"; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = "#fff"; ctx.font = "32px sans-serif"; ctx.fillText(`${kind === "screen" ? "SCREEN" : "CAMERA"}: ${label}`, 30, 150); ctx.fillText(new Date().toLocaleTimeString(), 30, 210); };
  draw();
  setInterval(draw, 200); // a timer, not animation frames, so a background tab keeps producing video during tests
  const s = c.captureStream(15);
  if (kind === "cam") {
    const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain(); g.gain.value = 0.001; const d = ac.createMediaStreamDestination(); o.connect(g); g.connect(d); o.start();
    d.stream.getAudioTracks().forEach((t) => s.addTrack(t));
  }
  return s;
}

// Remote microphones play through their own hidden element, so sound works whether or not that person's camera is on.
function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function Tile({ stream, name, muted, off, speaking, label, local, big }: { stream: MediaStream | null; name: string; muted?: boolean; off?: boolean; speaking?: boolean; label?: string; local?: boolean; big?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  const showVideo = stream && stream.getVideoTracks().length > 0 && !off;
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-[#121637] ${big ? "aspect-video" : "aspect-video"} ${speaking ? "ring-4 ring-primary" : "ring-1 ring-white/10"}`}>
      <video ref={ref} autoPlay playsInline muted={local} className={`h-full w-full ${big ? "object-contain" : "object-cover"} ${showVideo ? "" : "invisible"}`} />
      {!showVideo && <div className="absolute inset-0 grid place-items-center"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/30 text-xl font-semibold text-white">{name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span></div>}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/55 px-2 py-1 text-xs text-white">
        {muted && <Icon name="micoff" className="h-3.5 w-3.5 text-red-300" />}<span>{label ?? name}{local && !label ? " (you)" : ""}</span>
      </div>
    </div>
  );
}

export default function Room({ meetingId, title, kind, me, inviteUrl, fake }: { meetingId: string; title: string; kind: string; me: { name: string; isHost: boolean }; inviteUrl?: string; fake?: boolean }) {
  const [phase, setPhase] = useState<Phase>("prejoin");
  const [myId, setMyId] = useState("");
  const [isHost, setIsHost] = useState(me.isHost);
  const [people, setPeople] = useState<Person[]>([]);
  const [waiting, setWaiting] = useState<{ id: string; name: string }[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [panel, setPanel] = useState<"" | "chat" | "people">("");
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [, force] = useState(0);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mediaNote, setMediaNote] = useState<string | null>(null);

  const local = useRef<{ stream: MediaStream | null; mic: MediaStreamTrack | null; cam: MediaStreamTrack | null; screen: MediaStreamTrack | null; screenStream: MediaStream | null }>({ stream: null, mic: null, cam: null, screen: null, screenStream: null });
  const peers = useRef(new Map<string, Peer>());
  const ice = useRef<RTCIceServer[]>([]);
  const es = useRef<EventSource | null>(null);
  const idRef = useRef("");
  const stateRef = useRef<PeerState>({ muted: false, camOff: false, sharing: false });
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const levels = useRef(new Map<string, { ac: AudioContext; an: AnalyserNode }>());
  const rerender = () => force((n) => n + 1);

  // ---------- local media ----------
  const getMedia = useCallback(async () => {
    if (local.current.stream) return;
    try {
      const s = fake ? fakeStream(me.name, "cam") : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: { width: 1280, height: 720 } });
      local.current = { ...local.current, stream: s, mic: s.getAudioTracks()[0] ?? null, cam: s.getVideoTracks()[0] ?? null };
    } catch {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        local.current = { ...local.current, stream: s, mic: s.getAudioTracks()[0] ?? null, cam: null };
        setMediaNote("No camera available: you can still talk and see everyone.");
      } catch {
        setMediaNote("Camera and microphone are blocked or missing. You can still watch, share your screen and chat. Allow access in the browser address bar to talk.");
      }
    }
    rerender();
  }, [fake, me.name]);

  useEffect(() => { void getMedia(); }, [getMedia]);

  // ---------- signalling ----------
  const post = useCallback(async (route: string, body: unknown) => {
    const r = await fetch(`/api/meetings/${meetingId}/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error ?? `Error ${r.status}`); }
  }, [meetingId]);
  const signal = useCallback((to: string, kind: string, payload: unknown) => { post("signal", { to, kind, payload }).catch(() => undefined); }, [post]);
  const sendState = useCallback((to?: string) => { for (const id of to ? [to] : [...peers.current.keys()]) signal(id, "state", stateRef.current); }, [signal]);

  const watchLevel = useCallback((id: string, stream: MediaStream | null) => {
    levels.current.get(id)?.ac.close().catch(() => undefined);
    levels.current.delete(id);
    if (!stream || stream.getAudioTracks().length === 0) return;
    try {
      const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 256;
      ac.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(an);
      levels.current.set(id, { ac, an });
    } catch { /* no audio analysis: the speaking highlight is just absent */ }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      let best: string | null = null, max = 14;
      const buf = new Uint8Array(128);
      for (const [id, l] of levels.current) {
        if (id === idRef.current && stateRef.current.muted) continue;
        l.an.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        if (avg > max) { max = avg; best = id; }
      }
      setSpeaker((s) => (s === best ? s : best));
    }, 250);
    return () => clearInterval(t);
  }, []);

  const closePeer = useCallback((id: string) => {
    const p = peers.current.get(id);
    if (p) { p.pc.close(); peers.current.delete(id); }
    levels.current.get(id)?.ac.close().catch(() => undefined);
    levels.current.delete(id);
    rerender();
  }, []);

  const wire = useCallback((id: string, name: string, initiator: boolean): Peer => {
    const pc = new RTCPeerConnection({ iceServers: ice.current });
    const peer: Peer = { pc, initiator, name, cam: null, screen: null, audio: null, pending: [], state: { muted: false, camOff: false, sharing: false } };
    pc.onicecandidate = (e) => { if (e.candidate) signal(id, "candidate", e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      const lane = LANES[pc.getTransceivers().indexOf(e.transceiver)];
      const s = new MediaStream([e.track]);
      if (lane === "audio") { peer.audio = s; watchLevel(id, s); } else if (lane === "cam") peer.cam = s; else if (lane === "screen") peer.screen = s;
      e.track.onunmute = rerender; e.track.onmute = rerender; e.track.onended = rerender;
      rerender();
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") { setNotice(`The connection to ${peer.name} failed. If this keeps happening, the network may need a relay (see the help page).`); } rerender(); };
    peers.current.set(id, peer);
    return peer;
  }, [signal, watchLevel]);

  const attachLocal = useCallback((peer: Peer) => {
    const t = peer.pc.getTransceivers();
    const tracks = [local.current.mic, local.current.cam, local.current.screen];
    t.forEach((tr, i) => { if (i < 3) { tr.direction = "sendrecv"; tr.sender.replaceTrack(tracks[i]).catch(() => undefined); } });
  }, []);

  const callPeer = useCallback(async (id: string, name: string) => {
    if (peers.current.get(id)?.pc.connectionState === "connected") return;
    peers.current.get(id)?.pc.close();
    const peer = wire(id, name, true);
    for (const kind of ["audio", "video", "video"] as const) peer.pc.addTransceiver(kind, { direction: "sendrecv" });
    attachLocal(peer);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    signal(id, "offer", peer.pc.localDescription);
    sendState(id);
  }, [attachLocal, sendState, signal, wire]);

  const onSignal = useCallback(async (from: string, kind: string, payload: unknown) => {
    const known = people.find((p) => p.id === from)?.name ?? "Participant";
    if (kind === "state") { const p = peers.current.get(from); if (p) { p.state = payload as PeerState; rerender(); } return; }
    if (kind === "offer") {
      const existing = peers.current.get(from);
      // Both sides called each other at once: the person with the lower id keeps their call, the other answers.
      if (existing?.initiator && idRef.current < from && existing.pc.signalingState !== "stable") return;
      existing?.pc.close();
      const peer = wire(from, existing?.name ?? known, false);
      await peer.pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
      attachLocal(peer);
      for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => undefined);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      signal(from, "answer", peer.pc.localDescription);
      sendState(from);
    } else if (kind === "answer") {
      const peer = peers.current.get(from);
      if (peer && peer.pc.signalingState === "have-local-offer") {
        await peer.pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
        for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => undefined);
      }
    } else if (kind === "candidate") {
      const peer = peers.current.get(from);
      if (!peer) return;
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(payload as RTCIceCandidateInit).catch(() => undefined);
      else peer.pending.push(payload as RTCIceCandidateInit);
    }
  }, [attachLocal, people, sendState, signal, wire]);

  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  // ---------- connecting ----------
  const join = useCallback(() => {
    setPhase("connecting");
    const src = new EventSource(`/api/meetings/${meetingId}/events`);
    es.current = src;
    const on = <T,>(name: string, fn: (d: T) => void) => src.addEventListener(name, (ev) => fn(JSON.parse((ev as MessageEvent).data)));
    on<{ you: { id: string; isHost: boolean; status: string }; iceServers: RTCIceServer[] }>("hello", (d) => {
      idRef.current = d.you.id; setMyId(d.you.id); setIsHost(d.you.isHost); ice.current = d.iceServers;
      setPhase(d.you.status === "ADMITTED" ? "live" : "waiting");
    });
    const start = (d: { peers: { id: string; name: string }[]; messages: Msg[] }) => { setMessages(d.messages); setPhase("live"); for (const p of d.peers) void callPeer(p.id, p.name); };
    on("welcome", start);
    on("admitted", start);
    on<{ people: Person[]; waiting: { id: string; name: string }[] }>("roster", (d) => { setPeople(d.people); setWaiting(d.waiting); for (const p of d.people) { const peer = peers.current.get(p.id); if (peer) peer.name = p.name; } });
    on<{ from: string; kind: string; payload: unknown }>("signal", (d) => { void onSignalRef.current(d.from, d.kind, d.payload); });
    on<Msg>("chat", (m) => { setMessages((x) => [...x, m]); if (!panelRef.current.includes("chat") && m.participantId !== idRef.current) setUnread((n) => n + 1); });
    on<{ id: string }>("peer-left", (d) => closePeer(d.id));
    on("denied", () => { setPhase("denied"); src.close(); });
    on("removed", () => { setPhase("removed"); src.close(); closeAll(); });
    on("ended", () => { setPhase("ended"); src.close(); closeAll(); });
    src.onerror = () => setNotice("Connection interrupted. Reconnecting…");
    src.onopen = () => setNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callPeer, closePeer, meetingId]);

  const closeAll = useCallback(() => { for (const id of [...peers.current.keys()]) closePeer(id); local.current.stream?.getTracks().forEach((t) => t.stop()); local.current.screenStream?.getTracks().forEach((t) => t.stop()); }, [closePeer]);
  useEffect(() => () => { es.current?.close(); for (const p of peers.current.values()) p.pc.close(); local.current.stream?.getTracks().forEach((t) => t.stop()); local.current.screenStream?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (myId && local.current.stream) watchLevel(myId, local.current.stream); }, [myId, watchLevel, phase]);

  // ---------- controls ----------
  const toggleMic = () => { const t = local.current.mic; if (!t) return; t.enabled = !t.enabled; stateRef.current = { ...stateRef.current, muted: !t.enabled }; setMuted(!t.enabled); sendState(); };
  const toggleCam = async () => {
    if (!local.current.cam && !fake) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        const track = s.getVideoTracks()[0]; local.current.cam = track; local.current.stream?.addTrack(track);
        for (const p of peers.current.values()) p.pc.getTransceivers()[1]?.sender.replaceTrack(track).catch(() => undefined);
        stateRef.current = { ...stateRef.current, camOff: false }; setCamOff(false); sendState(); rerender();
      } catch { setMediaNote("Could not start the camera. Check that it is connected and allowed."); }
      return;
    }
    const t = local.current.cam; if (!t) return; t.enabled = !t.enabled; stateRef.current = { ...stateRef.current, camOff: !t.enabled }; setCamOff(!t.enabled); sendState();
  };
  const stopShare = useCallback(() => {
    local.current.screenStream?.getTracks().forEach((t) => t.stop());
    local.current = { ...local.current, screen: null, screenStream: null };
    for (const p of peers.current.values()) p.pc.getTransceivers()[2]?.sender.replaceTrack(null).catch(() => undefined);
    stateRef.current = { ...stateRef.current, sharing: false }; setSharing(false); sendState(); rerender();
  }, [sendState]);
  const startShare = async () => {
    try {
      const s = fake ? fakeStream(me.name, "screen") : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const track = s.getVideoTracks()[0];
      local.current = { ...local.current, screen: track, screenStream: s };
      track.onended = stopShare;
      for (const p of peers.current.values()) p.pc.getTransceivers()[2]?.sender.replaceTrack(track).catch(() => undefined);
      stateRef.current = { ...stateRef.current, sharing: true }; setSharing(true); sendState(); rerender();
    } catch { setNotice("Screen sharing was cancelled or is not allowed in this browser."); }
  };
  const leave = async () => { es.current?.close(); closeAll(); await post("admin", { action: "leave" }).catch(() => undefined); setPhase("ended"); };
  const endAll = async () => { if (confirm("End the meeting for everyone?")) await post("admin", { action: "end" }).catch((e) => setNotice(e.message)); };
  const send = async () => { const b = draft.trim(); if (!b) return; setDraft(""); try { await post("chat", { body: b }); } catch (e) { setNotice((e as Error).message); } };
  const decide = (action: string, target: string) => post("admin", { action, target }).catch((e) => setNotice(e.message));
  const copy = async () => { if (!inviteUrl) return; try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setNotice(inviteUrl); } };

  // ---------- layout ----------
  const remote = [...peers.current.entries()];
  const presenter = sharing ? { id: myId, name: me.name, stream: local.current.screenStream, mine: true } : remote.map(([id, p]) => ({ id, name: p.name, stream: p.screen, mine: false, on: p.state.sharing })).find((x) => x.on && x.stream);
  const camStream = local.current.stream;
  const tiles = useMemo(() => remote.map(([id, p]) => ({ id, name: p.name, cam: p.cam ?? p.audio, state: p.state })), [remote.map(([id, p]) => `${id}${p.cam?.id}${p.audio?.id}${p.state.muted}${p.state.camOff}`).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === "prejoin") {
    return (
      <div className="mx-auto grid max-w-4xl gap-6 p-4 md:grid-cols-[1.4fr_1fr] md:p-8">
        <div className="space-y-3">
          <Tile stream={camStream} name={me.name} muted={muted} off={camOff} local />
          <div className="flex gap-2"><button type="button" onClick={toggleMic} className="btn-ghost"><Icon name={muted ? "micoff" : "mic"} className="h-4 w-4" />{muted ? "Unmute" : "Mute"}</button><button type="button" onClick={toggleCam} className="btn-ghost"><Icon name={camOff ? "videooff" : "video"} className="h-4 w-4" />{camOff ? "Camera on" : "Camera off"}</button></div>
          {mediaNote && <p className="text-xs text-muted">{mediaNote}</p>}
        </div>
        <div className="space-y-4 self-center">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{kind === "WORKSHOP" ? "Online workshop" : "Meeting"}</p><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted">Joining as {me.name}</p></div>
          <button type="button" onClick={join} className="btn w-full !py-3">Join now</button>
          <p className="text-xs text-muted">Your browser will ask for permission to use the camera and microphone. Nothing is recorded by Hifi One.</p>
        </div>
      </div>
    );
  }

  if (phase === "waiting" || phase === "connecting") {
    return <div className="mx-auto max-w-md space-y-3 p-10 text-center"><h1 className="text-xl font-semibold">{phase === "waiting" ? "Waiting to be let in" : "Connecting…"}</h1><p className="text-sm text-muted">{phase === "waiting" ? "The host will admit you shortly. Keep this page open." : "Setting up your connection."}</p></div>;
  }
  if (phase === "denied" || phase === "removed" || phase === "ended") {
    return <div className="mx-auto max-w-md space-y-3 p-10 text-center"><h1 className="text-xl font-semibold">{phase === "denied" ? "The host did not let you in" : phase === "removed" ? "You were removed from the meeting" : "The meeting has ended"}</h1><p className="text-sm text-muted">You can close this page.</p></div>;
  }

  return (
    <div className="flex h-screen flex-col bg-[#0b0e24] text-white">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="text-xs text-white/60">{people.filter((p) => p.online).length || peers.current.size + 1} in the call{kind === "WORKSHOP" ? " · workshop" : ""}</p></div>
        {notice && <p role="status" className="max-w-md truncate rounded-lg bg-white/10 px-3 py-1 text-xs">{notice}</p>}
        {inviteUrl && <button type="button" onClick={copy} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"><Icon name="link" className="h-4 w-4" />{copied ? "Link copied" : "Copy guest link"}</button>}
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <main className="min-w-0 flex-1 overflow-y-auto">
          {remote.map(([id, p]) => (p.audio ? <RemoteAudio key={`a-${id}`} stream={p.audio} /> : null))}
          {presenter ? (
            <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
              <Tile stream={presenter.stream ?? null} name={presenter.name} label={`${presenter.mine ? "You are" : `${presenter.name} is`} presenting`} big />
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                <Tile stream={camStream} name={me.name} muted={muted} off={camOff} local speaking={speaker === myId} />
                {tiles.map((t) => <Tile key={t.id} stream={t.cam} name={t.name} muted={t.state.muted} off={t.state.camOff} speaking={speaker === t.id} />)}
              </div>
            </div>
          ) : (
            <div className={`grid gap-3 ${tiles.length === 0 ? "grid-cols-1 max-w-3xl mx-auto" : tiles.length < 3 ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
              <Tile stream={camStream} name={me.name} muted={muted} off={camOff} local speaking={speaker === myId} />
              {tiles.map((t) => <Tile key={t.id} stream={t.cam} name={t.name} muted={t.state.muted} off={t.state.camOff} speaking={speaker === t.id} />)}
            </div>
          )}
          {tiles.length === 0 && <p className="mt-6 text-center text-sm text-white/60">You are the only one here. {inviteUrl ? "Share the guest link to invite people." : "Others will appear as they join."}</p>}
        </main>

        {panel && (
          <aside className="flex w-80 shrink-0 flex-col rounded-2xl bg-white text-foreground shadow-xl" aria-label={panel === "chat" ? "Chat" : "People"}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="font-semibold">{panel === "chat" ? "Chat" : "People"}</h2><button type="button" onClick={() => setPanel("")} aria-label="Close panel" className="text-muted hover:text-foreground"><Icon name="close" className="h-4 w-4" /></button></div>
            {panel === "chat" ? (
              <>
                <ol className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
                  {messages.length === 0 && <li className="text-muted">No messages yet.</li>}
                  {messages.map((m) => <li key={m.id}><p className="text-xs text-muted">{m.participantId === myId ? "You" : m.authorName} · {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p><p className="whitespace-pre-wrap break-words">{m.body}</p></li>)}
                </ol>
                <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2 border-t border-border p-3"><input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder="Message everyone" aria-label="Message" className="input" /><button className="btn !px-3">Send</button></form>
              </>
            ) : (
              <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
                {isHost && waiting.length > 0 && (<div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Waiting to join</p><ul className="space-y-2">{waiting.map((w) => <li key={w.id} className="flex items-center justify-between gap-2"><span>{w.name}</span><span className="flex gap-1"><button type="button" className="btn !py-1 text-xs" onClick={() => decide("admit", w.id)}>Admit</button><button type="button" className="btn-ghost !py-1 text-xs" onClick={() => decide("deny", w.id)}>Deny</button></span></li>)}</ul></div>)}
                <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">In the call</p><ul className="space-y-2">{(people.length ? people : [{ id: myId, name: me.name, isHost, online: true }]).map((p) => <li key={p.id} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${p.online ? "bg-success" : "bg-muted"}`} />{p.id === myId ? `${p.name} (you)` : p.name}{p.isHost && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">host</span>}</span>{isHost && p.id !== myId && <button type="button" className="text-xs text-muted underline hover:text-brand" onClick={() => decide("remove", p.id)}>Remove</button>}</li>)}</ul></div>
              </div>
            )}
          </aside>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-2 px-4 pb-4">
        <Ctl on={!muted} icon={muted ? "micoff" : "mic"} label={muted ? "Unmute" : "Mute"} onClick={toggleMic} danger={muted} />
        <Ctl on={!camOff && !!local.current.cam} icon={camOff || !local.current.cam ? "videooff" : "video"} label={camOff || !local.current.cam ? "Start camera" : "Stop camera"} onClick={toggleCam} danger={camOff} />
        <Ctl on={sharing} icon="screen" label={sharing ? "Stop sharing" : "Share screen"} onClick={sharing ? stopShare : startShare} accent={sharing} />
        <Ctl on icon="chat" label="Chat" onClick={() => { setPanel(panel === "chat" ? "" : "chat"); setUnread(0); }} badge={unread} />
        <Ctl on icon="users" label="People" onClick={() => setPanel(panel === "people" ? "" : "people")} badge={isHost ? waiting.length : 0} />
        <button type="button" onClick={leave} className="flex h-11 items-center gap-2 rounded-full bg-red-600 px-5 text-sm font-medium hover:bg-red-700"><Icon name="phone" className="h-4 w-4 rotate-[135deg]" />Leave</button>
        {isHost && <button type="button" onClick={endAll} className="h-11 rounded-full border border-white/20 px-4 text-sm hover:bg-white/10">End for everyone</button>}
      </footer>
    </div>
  );
}

function Ctl({ icon, label, onClick, on, danger, accent, badge }: { icon: string; label: string; onClick: () => void; on: boolean; danger?: boolean; accent?: boolean; badge?: number }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={!on}
      className={`relative flex h-11 w-11 items-center justify-center rounded-full transition ${danger ? "bg-red-500/90 hover:bg-red-500" : accent ? "bg-primary hover:bg-primary-dark" : "bg-white/12 hover:bg-white/20"}`}>
      <Icon name={icon} className="h-5 w-5" />
      {!!badge && badge > 0 && <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-[18px]">{badge}</span>}
    </button>
  );
}
