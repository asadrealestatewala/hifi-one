"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Video } from "@/lib/partner-academy";
import { recordWatchAction } from "../actions";

// Plays the lesson video and counts the seconds actually played (skipping ahead does not count; watching again does not count
// twice). The count is kept in this browser between visits and sent to the server every 15 seconds and when the video ends.
// It is a guide for the partner, not proof: the quick check is the real check.

type YTPlayer = { getCurrentTime(): number; getDuration(): number; getPlayerState(): number; destroy(): void };
type YTApi = { Player: new (el: HTMLIFrameElement, o: { events: { onReady?: () => void; onStateChange?: (e: { data: number }) => void } }) => YTPlayer };
declare global { interface Window { YT?: YTApi; onYouTubeIframeAPIReady?: () => void } }

function loadYouTubeApi(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); if (window.YT) resolve(window.YT); };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
  });
}

const storeKey = (id: string) => `academy-watched:${id}`;
function loadSeconds(id: string): Set<number> {
  try { const raw = localStorage.getItem(storeKey(id)); return new Set(raw ? (JSON.parse(raw) as number[]) : []); } catch { return new Set(); }
}
function saveSeconds(id: string, s: Set<number>) { try { localStorage.setItem(storeKey(id), JSON.stringify([...s])); } catch { /* private window: progress is still sent */ } }

export default function LessonPlayer({ lessonId, video, title, initialPct, threshold }: { lessonId: string; video: Video; title: string; initialPct: number; threshold: number }) {
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const file = useRef<HTMLVideoElement>(null);
  const seconds = useRef<Set<number>>(new Set());
  const duration = useRef(0);
  const sentPct = useRef(initialPct);
  const [pct, setPct] = useState(initialPct);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { seconds.current = loadSeconds(lessonId); }, [lessonId]);

  const send = useCallback(async (force = false) => {
    const d = duration.current;
    if (!d) return;
    const now = Math.min(100, Math.round((seconds.current.size / Math.max(1, Math.floor(d))) * 100));
    saveSeconds(lessonId, seconds.current);
    setPct((p) => Math.max(p, now));
    if (now <= sentPct.current && !force) return;
    const before = sentPct.current;
    sentPct.current = Math.max(sentPct.current, now);
    const r = await recordWatchAction(lessonId, now);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    if (before < threshold && r.watched) router.refresh(); // the quick check opens
  }, [lessonId, router, threshold]);

  const onTime = useCallback((t: number, d: number) => {
    if (d > 0) duration.current = d;
    if (t >= 0) seconds.current.add(Math.floor(t));
  }, []);

  // YouTube: poll the position once a second while playing
  useEffect(() => {
    if (video.provider !== "youtube" || !frame.current) return;
    let player: YTPlayer | null = null;
    let tick: ReturnType<typeof setInterval> | undefined;
    let alive = true;
    loadYouTubeApi().then((YT) => {
      if (!alive || !frame.current) return;
      player = new YT.Player(frame.current, {
        events: {
          onReady: () => {
            tick = setInterval(() => { if (player && player.getPlayerState() === 1) onTime(player.getCurrentTime(), player.getDuration()); }, 1000);
          },
          onStateChange: (e) => { if (e.data === 0 || e.data === 2) void send(e.data === 0); },
        },
      });
    });
    return () => { alive = false; if (tick) clearInterval(tick); };
  }, [video.provider, onTime, send]);

  // Vimeo: the player's postMessage API reports timeupdate events
  useEffect(() => {
    if (video.provider !== "vimeo") return;
    const post = (msg: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(msg), "https://player.vimeo.com");
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== "https://player.vimeo.com") return;
      let data: { event?: string; data?: { seconds?: number; duration?: number } };
      try { data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data; } catch { return; }
      if (data.event === "ready") ["timeupdate", "pause", "ended"].forEach((value) => post({ method: "addEventListener", value }));
      if (data.event === "timeupdate" && data.data) onTime(Number(data.data.seconds ?? -1), Number(data.data.duration ?? 0));
      if (data.event === "pause" || data.event === "ended") void send(data.event === "ended");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [video.provider, onTime, send]);

  // Every 15 seconds, and when the partner leaves the page
  useEffect(() => {
    const t = setInterval(() => void send(), 15_000);
    const hide = () => { if (document.visibilityState === "hidden") void send(); };
    document.addEventListener("visibilitychange", hide);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", hide); };
  }, [send]);

  return (
    <section className="card space-y-3" aria-label="Lesson video">
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
        {video.provider === "file" ? (
          <video ref={file} src={video.embedUrl} controls playsInline className="h-full w-full" aria-label={title}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime, e.currentTarget.duration)} onPause={() => void send()} onEnded={() => void send(true)} />
        ) : (
          <iframe ref={frame} src={video.provider === "vimeo" ? `${video.embedUrl}&api=1` : video.embedUrl} title={title} className="h-full w-full"
            allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
        )}
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs"><span className="font-medium">Watched {pct}%</span><span className="text-muted">{pct >= threshold ? "The quick check is open below" : `Watch ${threshold}% to open the quick check`}</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label="Video watched" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${pct >= threshold ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-brand">{error}</p>}
    </section>
  );
}
