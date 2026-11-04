"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-reads the page's numbers every few seconds while the tab is visible, without a reload or losing the scroll position
export default function LiveRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, Math.max(5, seconds) * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return <span className="sr-only" role="status">Numbers on this page update by themselves every {seconds} seconds.</span>;
}
