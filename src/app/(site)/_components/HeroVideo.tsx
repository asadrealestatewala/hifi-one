"use client";

import { useEffect, useRef } from "react";

// The hero video. The poster frame paints straight away (so the panel is never blank), and the MP4 has its index at the
// start of the file (faststart) so playback begins after the first few hundred kilobytes instead of the whole file.
// People who ask the system for reduced motion see the still frame only.
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      v.pause();
      return;
    }
    v.play().catch(() => {
      /* autoplay refused (data saver): the poster stays */
    });
  }, []);
  return (
    <video ref={ref} muted loop playsInline autoPlay preload="auto" poster="/site/images/hero-poster.webp" width={1280} height={720} aria-label="Showreel: HIFI design work">
      <source src="/site/images/herovideo.mp4" type="video/mp4" />
    </video>
  );
}
