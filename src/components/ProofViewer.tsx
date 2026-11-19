"use client";

import { useRef, useState } from "react";
import SubmitButton from "@/components/ui/SubmitButton";

export type ProofComment = { id: string; body: string; author: string; fromClient: boolean; at: string; x: number | null; y: number | null; page: number | null; resolved: boolean; pin: number | null };

// The proof with its comments, shared by the client portal and the project page. On an image, clicking places a numbered pin for the
// next comment (Escape or "Remove pin" takes it away); on a PDF, the comment can name a page. Pins follow the comment list's numbers.
export default function ProofViewer({ src, kind, name, comments, hidden, comment, resolve, canComment, commentHint }: {
  src: string; kind: "image" | "pdf"; name: string; comments: ProofComment[]; hidden: Record<string, string>;
  comment?: (f: FormData) => Promise<void>; resolve?: (f: FormData) => Promise<void>; canComment: boolean; commentHint: string;
}) {
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const box = useRef<HTMLButtonElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const nextPin = comments.filter((c) => c.pin !== null).length + 1;
  const place = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!canComment || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPin({ x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) });
    text.current?.focus();
  };
  const fields = Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="card !p-2">
        {kind === "image" ? (
          <div className="relative">
            <button ref={box} type="button" onClick={place} onKeyDown={(e) => e.key === "Escape" && setPin(null)} disabled={!canComment}
              className={`block w-full ${canComment ? "cursor-crosshair" : "cursor-default"}`} aria-label={canComment ? "Click on the design to place a pin for your comment" : name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={name} className="block h-auto w-full rounded-lg" />
            </button>
            {comments.filter((c) => c.pin !== null).map((c) => (
              <button key={c.id} type="button" onClick={() => setActive(c.id)} style={{ left: `${c.x}%`, top: `${c.y}%` }} aria-label={`Comment ${c.pin}: ${c.body}`}
                className={`absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow ${c.resolved ? "bg-success" : "bg-primary"} ${active === c.id ? "ring-2 ring-primary ring-offset-2" : ""}`}>{c.pin}</button>
            ))}
            {pin && <span style={{ left: `${pin.x}%`, top: `${pin.y}%` }} className="pointer-events-none absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-brand text-xs font-semibold text-white shadow" aria-hidden>{nextPin}</span>}
          </div>
        ) : (
          <object data={src} type="application/pdf" className="h-[75vh] w-full rounded-lg" aria-label={name}>
            <p className="p-4 text-sm">This browser can&apos;t show the PDF here. <a href={src} className="text-primary underline">Open {name}</a></p>
          </object>
        )}
        <p className="flex flex-wrap justify-between gap-2 px-2 pt-2 text-xs text-muted"><span>{name}</span><a href={`${src}&dl=1`} className="hover:underline">Download</a></p>
      </div>
      <aside className="space-y-3" aria-label="Comments">
        {canComment && comment && (
          <form action={comment} className="card space-y-2" onSubmit={() => setTimeout(() => setPin(null), 0)}>
            {fields}
            {pin && <><input type="hidden" name="x" value={pin.x.toFixed(2)} /><input type="hidden" name="y" value={pin.y.toFixed(2)} /></>}
            <label className="label" htmlFor="proof-comment">{pin ? `Comment for pin ${nextPin}` : "Comment"}</label>
            <p className="text-xs text-muted">{pin ? <>Pin placed. <button type="button" className="text-primary underline" onClick={() => setPin(null)}>Remove pin</button></> : commentHint}</p>
            <textarea ref={text} id="proof-comment" name="body" required minLength={2} maxLength={2000} rows={3} className="input" />
            {kind === "pdf" && <div><label className="label" htmlFor="proof-page">Page (optional)</label><input id="proof-page" name="page" type="number" min={1} max={2000} className="input w-28" /></div>}
            <SubmitButton pendingText="Saving…">Add comment</SubmitButton>
          </form>
        )}
        {comments.length === 0 ? <p className="card text-sm text-muted">No comments on this version yet.</p> : (
          <ol className="card divide-y divide-border !py-1 text-sm">
            {comments.map((c) => (
              <li key={c.id} id={`c-${c.id}`} className={`space-y-1 py-3 ${active === c.id ? "bg-primary/5" : ""}`}>
                <div className="flex items-start gap-2">
                  {c.pin !== null ? <button type="button" onClick={() => setActive(c.id)} className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${c.resolved ? "bg-success" : "bg-primary"}`} aria-label={`Show pin ${c.pin}`}>{c.pin}</button> : <span className="size-6 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted"><span className="font-medium text-foreground">{c.author}</span>{c.fromClient ? " · client" : " · team"}{c.page ? ` · page ${c.page}` : ""} · {new Date(c.at).toLocaleString()}</p>
                    <p className={`whitespace-pre-wrap ${c.resolved ? "text-muted line-through" : ""}`}>{c.body}</p>
                    {c.resolved && <p className="text-xs text-success">Done</p>}
                  </div>
                </div>
                {resolve && (
                  <form action={resolve} className="pl-8">{fields}<input type="hidden" name="commentId" value={c.id} /><input type="hidden" name="resolved" value={c.resolved ? "0" : "1"} /><SubmitButton className="text-xs text-primary hover:underline" pendingText="Saving…">{c.resolved ? "Open again" : "Mark done"}</SubmitButton></form>
                )}
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
