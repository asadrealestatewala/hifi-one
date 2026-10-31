"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/ui";

// Typed name is the signature; drawing one as well is optional and sent as a small PNG.
export default function SignForm({ token, defaultName, signAction, declineAction }: { token: string; defaultName: string; signAction: (f: FormData) => void | Promise<void>; declineAction: (f: FormData) => void | Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState("");
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#111";
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height]; };
    const down = (e: PointerEvent) => { drawing.current = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
    const move = (e: PointerEvent) => { if (!drawing.current) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty.current = true; };
    const up = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) setImage(c.toDataURL("image/png")); };
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move); c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    return () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); c.removeEventListener("pointercancel", up); };
  }, []);

  const clear = () => { const c = canvas.current; c?.getContext("2d")?.clearRect(0, 0, c.width, c.height); dirty.current = false; setImage(""); };

  return (
    <div className="space-y-4">
      <form action={signAction} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="signatureImage" value={image} />
        <div><label className="label" htmlFor="sig-name">Type your full name to sign</label><input id="sig-name" name="name" required minLength={3} maxLength={120} defaultValue={defaultName} autoComplete="name" className="input" /></div>
        <div>
          <p className="label">Draw your signature (optional)</p>
          <canvas ref={canvas} width={600} height={160} aria-label="Signature drawing area" className="w-full touch-none rounded-lg border border-border bg-white" />
          <button type="button" className="mt-1 text-xs text-muted underline" onClick={clear}>Clear drawing</button>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" value="1" required className="mt-1" /> I have read this agreement and I agree to it. I understand that typing my name here is my electronic signature.</label>
        <SubmitButton className="btn w-full !py-2.5">Sign agreement</SubmitButton>
      </form>
      <div className="border-t border-border pt-3">
        {!declining ? <button type="button" className="text-sm text-muted underline" onClick={() => setDeclining(true)}>I do not want to sign</button> : (
          <form action={declineAction} className="space-y-2">
            <input type="hidden" name="token" value={token} />
            <label className="label" htmlFor="dec-reason">Why are you declining?</label>
            <textarea id="dec-reason" name="reason" required minLength={3} maxLength={500} rows={3} className="input" />
            <SubmitButton className="btn-ghost">Decline</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
