"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISS_KEY = "hifi.installHint.dismissedAt";
const DISMISS_DAYS = 30;
// Only offered where people actually sign in and start work, not on public website pages or one-time links
const SHOW_ON = (p: string) => p === "/login" || p.startsWith("/dashboard");

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Boolean(at) && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/** Registers the service worker and offers "Install app" (Android and desktop) or the Share-sheet steps (iPhone). */
export default function PwaClient() {
  const pathname = usePathname();
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone || recentlyDismissed()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    if (isIos && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) {
      setIos(true);
      setHidden(false);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setHidden(true);
  }

  async function install() {
    if (!event) return;
    await event.prompt();
    await event.userChoice.catch(() => null);
    setEvent(null);
    setHidden(true);
  }

  if (hidden || !SHOW_ON(pathname) || (!event && !ios)) return null;
  return (
    <div role="region" aria-label="Install Hifi One" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-lg">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-lg" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Install Hifi One</span>
        <span className="block text-muted">{ios ? "Tap Share, then Add to Home Screen." : "Open it from your home screen like an app."}</span>
      </p>
      {event && (
        <button type="button" onClick={install} className="min-h-11 shrink-0 rounded-lg bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-dark">
          Install app
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss install hint" className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover">
        ✕
      </button>
    </div>
  );
}
