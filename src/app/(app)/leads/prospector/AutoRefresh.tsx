"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-reads the page every few seconds while website checks are still waiting or running, then stops by itself (the parent stops rendering it)
export default function AutoRefresh({ seconds = 6 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return <span className="sr-only" role="status">Website checks are running. This list updates by itself.</span>;
}
