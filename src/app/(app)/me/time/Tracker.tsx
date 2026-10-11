"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { beat } from "./actions";

const pad = (n: number) => String(n).padStart(2, "0");
const hms = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

// Measures activity in THIS browser tab only: how many seconds there was movement, typing or clicking, how many key presses and
// clicks (counted, never recorded), and how long it was idle. It cannot see other applications or what is typed.
export default function Tracker({ sessionId, startedAtMs, onBreak, idleSeconds }: { sessionId: string; startedAtMs: number; onBreak: boolean; idleSeconds: number }) {
  const [elapsed, setElapsed] = useState(Math.floor((Date.now() - startedAtMs) / 1000));
  const [status, setStatus] = useState<"active" | "idle" | "break">(onBreak ? "break" : "active");
  const [note, setNote] = useState<string | null>(null);
  const acc = useRef({ active: 0, idle: 0, keys: 0, clicks: 0 });
  const last = useRef(Date.now());
  const sending = useRef(false);

  const flush = useCallback(async () => {
    const a = acc.current;
    if (sending.current || a.active + a.idle === 0) return;
    sending.current = true;
    const sent = { ...a };
    acc.current = { active: 0, idle: 0, keys: 0, clicks: 0 };
    try {
      const r = await beat(sessionId, sent.active, sent.idle, sent.keys, sent.clicks);
      if (!r.ok) setNote(r.error ?? "Could not save activity.");
      else setNote(r.outsideHours ? "Outside working hours: activity is not being recorded." : r.onBreak ? "On a break: nothing is recorded." : null);
    } catch {
      // network trouble: keep the counts for the next try
      acc.current = { active: acc.current.active + sent.active, idle: acc.current.idle + sent.idle, keys: acc.current.keys + sent.keys, clicks: acc.current.clicks + sent.clicks };
    } finally { sending.current = false; }
  }, [sessionId]);

  useEffect(() => {
    const touch = () => { last.current = Date.now(); };
    const key = () => { last.current = Date.now(); acc.current.keys++; }; // the key itself is never read, only counted
    const click = () => { last.current = Date.now(); acc.current.clicks++; };
    window.addEventListener("mousemove", touch); window.addEventListener("scroll", touch, true); window.addEventListener("touchstart", touch);
    window.addEventListener("keydown", key); window.addEventListener("click", click);
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtMs) / 1000));
      if (onBreak) return;
      const idle = Date.now() - last.current > idleSeconds * 1000;
      setStatus(idle ? "idle" : "active");
      if (idle) acc.current.idle++; else acc.current.active++;
    }, 1000);
    const send = setInterval(flush, 30_000);
    const leave = () => { void flush(); };
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(tick); clearInterval(send); window.removeEventListener("pagehide", leave);
      window.removeEventListener("mousemove", touch); window.removeEventListener("scroll", touch, true); window.removeEventListener("touchstart", touch);
      window.removeEventListener("keydown", key); window.removeEventListener("click", click);
    };
  }, [flush, idleSeconds, onBreak, startedAtMs]);

  const tone = status === "active" ? "bg-success" : status === "idle" ? "bg-warning" : "bg-muted";
  return (
    <div className="flex flex-wrap items-center gap-4" aria-live="polite">
      <span className="font-mono text-4xl font-semibold tracking-tight">{hms(elapsed)}</span>
      <span className="flex items-center gap-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${tone}`} />{status === "break" ? "On a break" : status === "idle" ? "Idle" : "Active"}</span>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}
