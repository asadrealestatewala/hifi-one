"use client";

import { useEffect, useRef, useState } from "react";

const HUES = ["#5648e8", "#8b5cf6", "#2563eb", "#f97316", "#059669", "#e11d74", "#d97706", "#0d9488"];

// A person's picture, or their initials on a colour when they have none. Pass `userId` for staff so their uploaded photo shows;
// if the photo cannot be loaded the initials stay, so a missing picture never leaves a broken image.
export default function Avatar({ name, size = 32, userId }: { name: string; size?: number; userId?: string | null }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // A server-rendered image can fail before React attaches onError, so check once on mount as well
  useEffect(() => { const i = img.current; if (i && i.complete && i.naturalWidth === 0) setFailed(true); }, [userId]);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38, background: HUES[h % HUES.length] }} title={name}>
      <span aria-hidden>{initials}</span>
      {userId && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} src={`/api/avatar/${userId}`} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}
