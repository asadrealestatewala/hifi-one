"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import { EMOJI } from "./emoji";

type Room = {
  id: string; kind: string; name: string; directUserId: string | null; projectId: string | null; members: { id: string; name: string; role: string }[];
  unread: number; lastMessageAt: string; lastMessage: { body: string; kind: string; senderName: string | null; deleted: boolean } | null; muted: boolean; isAdmin: boolean;
};
type Msg = { id: string; roomId: string; senderId: string | null; senderName: string | null; kind: string; body: string; createdAt: string; deleted: boolean; attachments: { id: string; filename: string; contentType: string; size: number }[] };
type Person = { id: string; name: string };
type Reads = Record<string, Record<string, string>>; // roomId -> userId -> last read time

const MAX_FILE = 50 * 1024 * 1024;
const MAX_VOICE_SECONDS = 300;
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/ogg,audio/wav,application/pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm,.mp3,.m4a,.ogg,.wav";
const EXT_OK = /\.(png|jpe?g|gif|webp|mp4|mov|webm|weba|mp3|m4a|ogg|wav|pdf|docx|xlsx|csv|txt)$/i;
const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const LAST_LABEL: Record<string, string> = { IMAGE: "📷 Picture", VIDEO: "🎥 Video", AUDIO: "🎤 Voice message", FILE: "📎 File" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const y = new Date(); y.setDate(t.getDate() - 1);
  return same(d, t) ? "Today" : same(d, y) ? "Yesterday" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
};
const preview = (r: Room, meName: string) => {
  const m = r.lastMessage;
  if (!m) return "No messages yet";
  if (m.deleted) return "This message was deleted";
  const label = LAST_LABEL[m.kind];
  const text = label ? (m.body ? `${label.split(" ")[0]} ${m.body}` : label) : m.body;
  const who = m.kind === "SYSTEM" || !m.senderName ? "" : r.kind === "DIRECT" && m.senderName !== meName ? "" : `${m.senderName === meName ? "You" : m.senderName.split(" ")[0]}: `;
  return who + text;
};

export default function ChatApp({ meId, meName, initialRoom }: { meId: string; meName: string; initialRoom: string | null }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialRoom);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [reads, setReads] = useState<Reads>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<null | "new" | "info">(null);
  const [live, setLive] = useState(false);
  const activeRef = useRef<string | null>(activeId);
  const listEnd = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeRef.current = activeId;

  const loadRooms = useCallback(async () => {
    try { setRooms((await api<{ rooms: Room[] }>("/api/chat/rooms")).rooms); } catch (e) { setError((e as Error).message); setRooms((cur) => cur ?? []); }
  }, []);
  const reloadSoon = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void loadRooms(), 250);
  }, [loadRooms]);

  const markRead = useCallback((roomId: string) => {
    void fetch(`/api/chat/rooms/${roomId}/read`, { method: "POST" }).catch(() => {});
    setRooms((cur) => cur?.map((r) => (r.id === roomId ? { ...r, unread: 0 } : r)) ?? cur);
  }, []);

  const loadMessages = useCallback(async (roomId: string) => {
    setLoading(true);
    try {
      const d = await api<{ messages: Msg[]; hasMore: boolean; reads: { userId: string; at: string }[] }>(`/api/chat/rooms/${roomId}/messages`);
      if (activeRef.current !== roomId) return;
      stickToBottom.current = true;
      setMsgs(d.messages); setHasMore(d.hasMore);
      setReads((cur) => ({ ...cur, [roomId]: Object.fromEntries(d.reads.map((r) => [r.userId, r.at])) }));
      setError(null);
      markRead(roomId);
    } catch (e) { setError((e as Error).message); setMsgs([]); } finally { setLoading(false); }
  }, [markRead]);

  // Rooms first, then the live stream. A reconnect after a dropped connection reloads what was missed.
  useEffect(() => { void loadRooms(); }, [loadRooms]);
  useEffect(() => {
    if (!activeId) { setMsgs([]); return; }
    void loadMessages(activeId);
  }, [activeId, loadMessages]);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let first = true;
    const connect = () => {
      es = new EventSource("/api/chat/events");
      es.addEventListener("hello", () => {
        setLive(true);
        if (!first) { void loadRooms(); if (activeRef.current) void loadMessages(activeRef.current); }
        first = false;
      });
      es.addEventListener("message", (ev) => {
        const { message } = JSON.parse((ev as MessageEvent).data) as { message: Msg };
        if (message.roomId === activeRef.current) {
          setMsgs((cur) => (cur.some((m) => m.id === message.id) ? cur : [...cur, message]));
          if (document.visibilityState === "visible" && message.senderId !== meId) markRead(message.roomId);
        }
        reloadSoon();
      });
      es.addEventListener("read", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as { roomId: string; userId: string; at: string };
        setReads((cur) => ({ ...cur, [d.roomId]: { ...(cur[d.roomId] ?? {}), [d.userId]: d.at } }));
      });
      es.addEventListener("deleted", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as { roomId: string; messageId: string };
        setMsgs((cur) => cur.map((m) => (m.id === d.messageId ? { ...m, deleted: true, body: "", attachments: [] } : m)));
        reloadSoon();
      });
      es.addEventListener("room", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as { roomId: string };
        reloadSoon();
        if (d.roomId === activeRef.current) void loadMessages(d.roomId);
      });
      es.onerror = () => { setLive(false); if (es?.readyState === EventSource.CLOSED && !closed) { es.close(); setTimeout(connect, 3000); } };
    };
    connect();
    const onVisible = () => { if (document.visibilityState === "visible" && activeRef.current) markRead(activeRef.current); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { closed = true; es?.close(); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadRooms, loadMessages, markRead, meId, reloadSoon]);

  // Keep the newest message in view unless the person scrolled up to read older ones
  useEffect(() => { if (stickToBottom.current) listEnd.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  const active = rooms?.find((r) => r.id === activeId) ?? null;
  const totalUnread = rooms?.reduce((n, r) => n + (r.muted ? 0 : r.unread), 0) ?? 0;
  useEffect(() => {
    const base = "Hifi One";
    document.title = totalUnread > 0 ? `(${totalUnread}) Team chat · ${base}` : `Team chat · ${base}`;
  }, [totalUnread]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (rooms ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [rooms, filter]);

  async function older() {
    if (!activeId || msgs.length === 0) return;
    const before = msgs[0].createdAt;
    const el = scroller.current;
    const prevH = el?.scrollHeight ?? 0;
    try {
      const d = await api<{ messages: Msg[]; hasMore: boolean }>(`/api/chat/rooms/${activeId}/messages?before=${encodeURIComponent(before)}`);
      stickToBottom.current = false;
      setMsgs((cur) => [...d.messages, ...cur]); setHasMore(d.hasMore);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevH; });
    } catch (e) { setError((e as Error).message); }
  }

  const open = (id: string) => { setActiveId(id); history.replaceState(null, "", `/chat?room=${id}`); };
  const back = () => { setActiveId(null); history.replaceState(null, "", "/chat"); };

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[28rem] overflow-hidden rounded-xl border border-border bg-surface">
      {/* Conversations */}
      <aside className={`${activeId ? "hidden md:flex" : "flex"} w-full flex-col border-r border-border md:w-80 md:shrink-0`}>
        <div className="flex items-center gap-2 border-b border-border p-3">
          <h1 className="flex-1 text-lg font-semibold tracking-tight">Team chat</h1>
          <span title={live ? "Connected" : "Reconnecting…"} className={`h-2 w-2 rounded-full ${live ? "bg-success" : "bg-warning"}`} />
          <button className="btn" onClick={() => setDialog("new")}>New chat</button>
        </div>
        <div className="p-3 pb-2"><input className="input" placeholder="Search conversations" aria-label="Search conversations" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <ul className="flex-1 overflow-y-auto" aria-label="Conversations">
          {rooms === null && <li className="p-4 text-sm text-muted">Loading…</li>}
          {rooms && shown.length === 0 && (
            <li className="p-4 text-sm text-muted">{filter ? "No conversation matches." : "No conversations yet. Press New chat to message a colleague or start a group."}</li>
          )}
          {shown.map((r) => (
            <li key={r.id}>
              <button onClick={() => open(r.id)} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hover ${r.id === activeId ? "bg-hover" : ""}`}>
                <RoomAvatar room={r} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{r.name}</span>
                    <span className="shrink-0 text-[11px] text-muted">{r.lastMessage ? timeOrDay(r.lastMessageAt) : ""}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted">{preview(r, meName)}</span>
                    {r.unread > 0 && <span className={`min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 text-white ${r.muted ? "bg-muted" : "bg-brand"}`}>{r.unread > 99 ? "99+" : r.unread}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversation */}
      <section className={`${activeId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {!active ? (
          <div className="m-auto max-w-xs p-6 text-center text-sm text-muted">
            <p className="text-base font-semibold text-foreground">{rooms && activeId ? "Conversation not found" : "Pick a conversation"}</p>
            <p className="mt-1">Choose a chat on the left, or press New chat to message a colleague or start a group. Every project also has its own room.</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-border p-3">
              <button className="rounded-lg p-1.5 text-muted hover:bg-hover md:hidden" onClick={back} aria-label="Back to conversations">←</button>
              <RoomAvatar room={active} />
              <button className="min-w-0 flex-1 text-left" onClick={() => setDialog("info")}>
                <span className="block truncate text-sm font-semibold">{active.name}</span>
                <span className="block truncate text-xs text-muted">{active.kind === "DIRECT" ? "Direct message" : `${active.kind === "PROJECT" ? "Project room · " : ""}${active.members.length} people: ${active.members.map((m) => (m.id === meId ? "You" : m.name.split(" ")[0])).join(", ")}`}</span>
              </button>
              <button className="btn-ghost" onClick={() => setDialog("info")}>Details</button>
            </header>
            <div ref={scroller} className="flex-1 overflow-y-auto bg-background px-3 py-3" onScroll={(e) => { const t = e.currentTarget; stickToBottom.current = t.scrollHeight - t.scrollTop - t.clientHeight < 80; }}>
              {hasMore && <div className="pb-3 text-center"><button className="btn-ghost" onClick={older}>Load earlier messages</button></div>}
              {loading && msgs.length === 0 && <p className="p-4 text-center text-sm text-muted">Loading…</p>}
              {!loading && msgs.length === 0 && !error && <p className="p-4 text-center text-sm text-muted">No messages yet. Say hello 👋</p>}
              <Messages msgs={msgs} room={active} meId={meId} reads={reads[active.id] ?? {}} onDelete={async (id) => { try { await api(`/api/chat/messages/${id}`, { method: "DELETE" }); } catch (e) { setError((e as Error).message); } }} />
              <div ref={listEnd} />
            </div>
            {error && <p role="alert" className="border-t border-border bg-brand/10 px-3 py-2 text-sm text-brand" onClick={() => setError(null)}>{error}</p>}
            <Composer roomId={active.id} onSent={(m) => { stickToBottom.current = true; setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m])); reloadSoon(); }} onError={setError} />
          </>
        )}
      </section>

      {dialog === "new" && <NewChat onClose={() => setDialog(null)} onCreated={async (id) => { setDialog(null); await loadRooms(); open(id); }} />}
      {dialog === "info" && active && <RoomInfo room={active} meId={meId} onClose={() => setDialog(null)} onChanged={loadRooms} onLeft={async () => { setDialog(null); back(); await loadRooms(); }} />}
    </div>
  );
}

const timeOrDay = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? timeOf(iso) : dayLabel(iso));

function RoomAvatar({ room, size = 40 }: { room: Room; size?: number }) {
  if (room.kind === "DIRECT") return <Avatar name={room.name} userId={room.directUserId} size={size} />;
  return <Avatar name={room.name.replace(/^[A-Z]+-\d+\s*/, "") || room.name} size={size} />;
}

function Messages({ msgs, room, meId, reads, onDelete }: { msgs: Msg[]; room: Room; meId: string; reads: Record<string, string>; onDelete: (id: string) => void }) {
  const others = room.members.filter((m) => m.id !== meId);
  const out: React.ReactNode[] = [];
  let lastDay = "";
  msgs.forEach((m, i) => {
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) { lastDay = day; out.push(<div key={`d-${m.id}`} className="my-3 text-center"><span className="rounded-full bg-hover px-3 py-0.5 text-[11px] text-muted">{dayLabel(m.createdAt)}</span></div>); }
    if (m.kind === "SYSTEM") { out.push(<p key={m.id} className="my-2 text-center text-xs text-muted">{m.body}</p>); return; }
    const mine = m.senderId === meId;
    const prev = msgs[i - 1];
    const newGroup = !prev || prev.senderId !== m.senderId || prev.kind === "SYSTEM" || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000 || new Date(prev.createdAt).toDateString() !== day;
    const readBy = others.filter((o) => reads[o.id] && reads[o.id] >= m.createdAt).length;
    const tick = readBy === 0 ? "✓" : "✓✓";
    const tickTone = others.length > 0 && readBy === others.length ? "text-primary" : "text-muted";
    const tickTitle = readBy === 0 ? "Sent" : room.kind === "DIRECT" ? "Read" : `Read by ${readBy} of ${others.length}`;
    out.push(
      <div key={m.id} className={`group flex items-end gap-2 ${mine ? "justify-end" : ""} ${newGroup ? "mt-3" : "mt-0.5"}`}>
        {!mine && (room.kind === "DIRECT" ? null : newGroup ? <Avatar name={m.senderName ?? "?"} userId={m.senderId} size={28} /> : <span className="w-7 shrink-0" />)}
        <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm shadow-sm ${mine ? "rounded-br-sm bg-primary text-white" : "rounded-bl-sm border border-border bg-surface"}`}>
          {!mine && newGroup && room.kind !== "DIRECT" && <p className="mb-0.5 text-xs font-semibold text-primary">{m.senderName}</p>}
          {m.deleted ? (
            <p className={`italic ${mine ? "text-white/80" : "text-muted"}`}>This message was deleted</p>
          ) : (
            <>
              {m.attachments.map((a) => <Attachment key={a.id} a={a} mine={mine} />)}
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
            </>
          )}
          <p className={`mt-0.5 flex items-center justify-end gap-1.5 text-[10px] ${mine ? "text-white/70" : "text-muted"}`}>
            {mine && !m.deleted && <button className="hidden underline group-hover:inline focus:inline" onClick={() => { if (confirm("Delete this message for everyone?")) onDelete(m.id); }}>Delete</button>}
            <span>{timeOf(m.createdAt)}</span>
            {mine && !m.deleted && <span title={tickTitle} className={mine && tickTone === "text-primary" ? "text-sky-200" : ""}>{tick}</span>}
          </p>
        </div>
      </div>,
    );
  });
  return <>{out}</>;
}

function Attachment({ a, mine }: { a: Msg["attachments"][number]; mine: boolean }) {
  const url = `/api/chat/files/${a.id}`;
  if (a.contentType.startsWith("image/"))
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={url} target="_blank" rel="noopener noreferrer" className="mb-1 block"><img src={url} alt={a.filename} loading="lazy" className="max-h-72 max-w-full rounded-lg object-cover" /></a>;
  if (a.contentType.startsWith("video/")) return <video src={url} controls preload="metadata" playsInline className="mb-1 max-h-72 max-w-full rounded-lg bg-black" aria-label={a.filename} />;
  if (a.contentType.startsWith("audio/")) return <audio src={url} controls preload="metadata" className="mb-1 h-10 w-64 max-w-full" aria-label="Voice message" />;
  return (
    <a href={`${url}?dl=1`} className={`mb-1 flex items-center gap-2 rounded-lg border px-3 py-2 ${mine ? "border-white/30 hover:bg-white/10" : "border-border hover:bg-hover"}`}>
      <span aria-hidden className="text-xl">📄</span>
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{a.filename}</span><span className={`block text-[11px] ${mine ? "text-white/70" : "text-muted"}`}>{sizeLabel(a.size)} · Download</span></span>
    </a>
  );
}

function Composer({ roomId, onSent, onError }: { roomId: string; onSent: (m: Msg) => void; onError: (e: string | null) => void }) {
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [emoji, setEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<null | { seconds: number }>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const recorder = useRef<{ stop: (keep: boolean) => void } | null>(null);

  // A draft belongs to its conversation; switching rooms starts clean
  useEffect(() => { recorder.current?.stop(false); setText(""); setAttached(null); setEmoji(false); }, [roomId]);
  useEffect(() => () => recorder.current?.stop(false), []);
  useEffect(() => {
    if (!attached || !/^(image|video|audio)\//.test(attached.type)) { setPreview(null); return; }
    const url = URL.createObjectURL(attached);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attached]);
  useEffect(() => { const t = ta.current; if (t) { t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 140)}px`; } }, [text]);

  function pick(f: File | null | undefined) {
    if (!f) return;
    const named = f.name || "pasted-picture.png";
    if (!EXT_OK.test(named)) { onError("This file type cannot be sent. Allowed: pictures, videos (MP4, MOV, WebM), voice notes, PDF, Word, Excel, CSV and text files."); return; }
    if (f.size > MAX_FILE) { onError(`That file is too large (${sizeLabel(f.size)}). The limit is 50 MB.`); return; }
    onError(null); setAttached(f.name ? f : new File([f], named, { type: f.type }));
  }
  function insert(e: string) {
    const t = ta.current;
    const s = t?.selectionStart ?? text.length, en = t?.selectionEnd ?? text.length;
    setText(text.slice(0, s) + e + text.slice(en));
    requestAnimationFrame(() => { t?.focus(); t?.setSelectionRange(s + e.length, s + e.length); });
  }
  async function post(f: File | null, body: string) {
    setBusy(true); onError(null);
    try {
      const init: RequestInit = f
        ? { method: "POST", body: (() => { const fd = new FormData(); fd.set("body", body); fd.set("file", f); return fd; })() }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) };
      const d = await api<{ message: Msg }>(`/api/chat/rooms/${roomId}/messages`, init);
      setText(""); setAttached(null); setEmoji(false);
      onSent(d.message);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); requestAnimationFrame(() => ta.current?.focus()); }
  }
  const send = () => { if (!busy && (text.trim() || attached)) void post(attached, text); };

  // Voice note: record from the microphone, then send on stop. Needs HTTPS and the person's permission.
  async function startVoice() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { onError("This browser cannot record voice notes."); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { onError("Allow microphone access in your browser to record a voice note."); return; }
    const pickType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const mr = new MediaRecorder(stream, pickType ? { mimeType: pickType } : undefined);
    const chunks: Blob[] = [];
    let keep = true, seconds = 0;
    const timer = setInterval(() => { seconds += 1; setRec({ seconds }); if (seconds >= MAX_VOICE_SECONDS) mr.stop(); }, 1000);
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); setRec(null); recorder.current = null;
      if (!keep || chunks.length === 0 || seconds < 1) return;
      const type = mr.mimeType || pickType || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "weba";
      void post(new File([new Blob(chunks, { type })], `voice-${Date.now()}.${ext}`, { type }), "");
    };
    recorder.current = { stop: (k) => { keep = k; if (mr.state !== "inactive") mr.stop(); } };
    setRec({ seconds: 0 });
    mr.start();
  }

  const kindIcon = attached ? (attached.type.startsWith("video/") ? "🎥" : attached.type.startsWith("audio/") ? "🎤" : /^image\//.test(attached.type) ? "" : "📄") : "";
  return (
    <div className="relative border-t border-border p-2">
      {attached && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border p-2">
          {preview && attached.type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-14 w-14 rounded object-cover" />
          ) : preview && attached.type.startsWith("video/") ? (
            <video src={preview} muted playsInline className="h-14 w-14 rounded bg-black object-cover" />
          ) : <span className="grid h-14 w-14 place-items-center rounded bg-hover text-2xl" aria-hidden>{kindIcon || "📄"}</span>}
          <span className="min-w-0 flex-1"><span className="block truncate text-sm">{attached.name}</span><span className="text-xs text-muted">{sizeLabel(attached.size)}</span></span>
          <button className="btn-ghost" onClick={() => setAttached(null)} aria-label="Remove attachment">Remove</button>
        </div>
      )}
      {emoji && (
        <div className="absolute bottom-full left-2 z-10 mb-1 max-h-64 w-72 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-lg" role="dialog" aria-label="Emoji">
          {EMOJI.map((g) => (
            <div key={g.label} className="mb-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label}</p>
              <div className="grid grid-cols-8 gap-0.5">{g.items.map((e) => <button key={e} className="rounded p-1 text-lg hover:bg-hover" onClick={() => insert(e)} aria-label={e}>{e}</button>)}</div>
            </div>
          ))}
        </div>
      )}
      {rec ? (
        <div className="flex items-center gap-3 px-2 py-1" role="status" aria-live="polite">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" aria-hidden />
          <span className="flex-1 text-sm">Recording… {Math.floor(rec.seconds / 60)}:{String(rec.seconds % 60).padStart(2, "0")}</span>
          <button className="btn-ghost" onClick={() => recorder.current?.stop(false)}>Cancel</button>
          <button className="btn" onClick={() => recorder.current?.stop(true)}>Send voice note</button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <button className="rounded-lg p-2 text-lg hover:bg-hover" onClick={() => setEmoji((v) => !v)} aria-expanded={emoji} aria-label="Add emoji" title="Emoji">😊</button>
          <button className="rounded-lg p-2 text-lg hover:bg-hover" onClick={() => file.current?.click()} aria-label="Attach a picture, video or file" title="Attach a picture, video or file">📎</button>
          <input ref={file} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          <textarea
            ref={ta} rows={1} value={text} maxLength={4000} aria-label="Message" placeholder="Type a message" className="input max-h-36 flex-1 resize-none"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            onPaste={(e) => { const f = [...e.clipboardData.files][0]; if (f) { e.preventDefault(); pick(f); } }}
          />
          {text.trim() || attached ? (
            <button className="btn" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send"}</button>
          ) : (
            <button className="btn" onClick={() => void startVoice()} disabled={busy} aria-label="Record a voice note" title="Record a voice note">{busy ? "Sending…" : "🎤"}</button>
          )}
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border p-4"><h2 className="font-semibold">{title}</h2><button className="btn-ghost" onClick={onClose}>Close</button></div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function PeoplePicker({ selected, onToggle, exclude = [] }: { selected: Set<string>; onToggle: (p: Person) => void; exclude?: string[] }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    const t = setTimeout(async () => { try { setPeople((await api<{ people: Person[] }>(`/api/chat/people?q=${encodeURIComponent(q)}`)).people); } catch { setPeople([]); } }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const list = (people ?? []).filter((p) => !exclude.includes(p.id));
  return (
    <div>
      <input className="input" placeholder="Search by name" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-2 max-h-64 overflow-y-auto">
        {people === null && <li className="p-2 text-sm text-muted">Loading…</li>}
        {people && list.length === 0 && <li className="p-2 text-sm text-muted">No one found.</li>}
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-hover" onClick={() => onToggle(p)} aria-pressed={selected.has(p.id)}>
              <Avatar name={p.name} userId={p.id} size={32} /><span className="flex-1 text-sm">{p.name}</span>{selected.has(p.id) && <span className="text-primary" aria-hidden>✓</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewChat({ onClose, onCreated }: { onClose: () => void; onCreated: (roomId: string) => void }) {
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Map<string, Person>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const post = async (body: unknown) => {
    setBusy(true); setErr(null);
    try { onCreated((await api<{ roomId: string }>("/api/chat/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).roomId); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const toggle = (p: Person) => setPicked((cur) => { const n = new Map(cur); if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p); return n; });
  return (
    <Modal title="New chat" onClose={onClose}>
      <div className="mb-3 flex gap-1 rounded-lg bg-hover p-1" role="tablist">
        {(["direct", "group"] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setPicked(new Map()); }} className={`flex-1 rounded-md py-1.5 text-sm font-medium ${mode === m ? "bg-surface shadow-sm" : "text-muted"}`}>{m === "direct" ? "Message someone" : "New group"}</button>)}
      </div>
      {mode === "group" && (
        <label className="mb-3 block text-sm font-medium">Group name
          <input className="input mt-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="For example, Design team" />
        </label>
      )}
      <PeoplePicker selected={new Set(picked.keys())} onToggle={(p) => (mode === "direct" ? void post({ kind: "direct", userId: p.id }) : toggle(p))} />
      {err && <p role="alert" className="mt-2 text-sm text-brand">{err}</p>}
      {mode === "group" && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted">{picked.size} selected</span>
          <button className="btn" disabled={busy || picked.size === 0 || name.trim().length < 2} onClick={() => void post({ kind: "group", name, memberIds: [...picked.keys()] })}>{busy ? "Creating…" : "Create group"}</button>
        </div>
      )}
    </Modal>
  );
}

function RoomInfo({ room, meId, onClose, onChanged, onLeft }: { room: Room; meId: string; onClose: () => void; onChanged: () => void | Promise<void>; onLeft: () => void | Promise<void> }) {
  const [name, setName] = useState(room.name);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Map<string, Person>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const group = room.kind === "GROUP";
  const act = async (body: unknown, then?: () => void | Promise<void>) => {
    setErr(null);
    try { await api(`/api/chat/rooms/${room.id}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); await (then ?? onChanged)(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={room.kind === "DIRECT" ? "Conversation details" : "Group details"} onClose={onClose}>
      {group && room.isAdmin && (
        <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void act({ action: "rename", name }); }}>
          <input className="input flex-1" value={name} maxLength={80} aria-label="Group name" onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={name.trim() === room.name || name.trim().length < 2}>Rename</button>
        </form>
      )}
      <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={room.muted} onChange={(e) => void act({ action: "mute", muted: e.target.checked })} /> Mute phone alerts for this conversation</label>
      <h3 className="mb-1 text-sm font-semibold">{room.members.length} people</h3>
      <ul className="mb-3">
        {room.members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-1.5">
            <Avatar name={m.name} userId={m.id} size={32} />
            <span className="flex-1 text-sm">{m.name}{m.id === meId ? " (you)" : ""}{m.role === "ADMIN" && group ? <span className="ml-2 rounded bg-hover px-1.5 py-0.5 text-[11px] text-muted">Admin</span> : null}</span>
            {group && room.isAdmin && m.id !== meId && <button className="btn-ghost" onClick={() => { if (confirm(`Remove ${m.name} from this group?`)) void act({ action: "remove", userId: m.id }); }}>Remove</button>}
          </li>
        ))}
      </ul>
      {room.kind === "PROJECT" && <p className="mb-3 text-xs text-muted">This room follows the project&apos;s team: people are added and removed as the project team changes.</p>}
      {group && room.isAdmin && (
        adding ? (
          <div>
            <PeoplePicker selected={new Set(picked.keys())} exclude={room.members.map((m) => m.id)} onToggle={(p) => setPicked((cur) => { const n = new Map(cur); if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p); return n; })} />
            <button className="btn mt-2" disabled={picked.size === 0} onClick={() => void act({ action: "add", userIds: [...picked.keys()] }, () => { setAdding(false); setPicked(new Map()); return onChanged(); })}>Add {picked.size || ""} {picked.size === 1 ? "person" : "people"}</button>
          </div>
        ) : <button className="btn-ghost" onClick={() => setAdding(true)}>Add people</button>
      )}
      {group && <div className="mt-4 border-t border-border pt-3"><button className="btn-ghost text-brand" onClick={() => { if (confirm("Leave this group? You will stop receiving its messages.")) void act({ action: "remove", userId: meId }, onLeft); }}>Leave group</button></div>}
      {err && <p role="alert" className="mt-2 text-sm text-brand">{err}</p>}
    </Modal>
  );
}
