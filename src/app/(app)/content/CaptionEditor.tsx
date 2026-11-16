"use client";

import { useState } from "react";
import { CAPTION_LIMITS, PLATFORM_META, countHashtags, MAX_HASHTAGS } from "@/lib/content-rules";
import { PlatformDot } from "./PostForm";

// Main caption, hashtags, first comment and an optional caption per platform, with a live count against each platform's
// limit and a preview of what each platform will show. Field names: copy, hashtags, firstComment, pc_<PLATFORM>.
export default function CaptionEditor({ platforms, copy, hashtags, firstComment, platformCopy }: { platforms: string[]; copy: string; hashtags: string; firstComment: string; platformCopy: Record<string, string> }) {
  const [main, setMain] = useState(copy);
  const [tags, setTags] = useState(hashtags);
  const [own, setOwn] = useState<Record<string, string>>(platformCopy);
  const [open, setOpen] = useState<string>(platforms[0] ?? "");
  const full = (p: string) => { const body = (own[p]?.trim() ? own[p] : main).trim(); return tags.trim() ? `${body}\n\n${tags.trim()}` : body; };

  return (
    <div className="grid gap-3">
      <div><label className="label" htmlFor="ce-copy">Main caption (used by every platform without its own; saving a change creates a new version)</label>
        <textarea id="ce-copy" name="copy" rows={5} value={main} onChange={(e) => setMain(e.target.value)} className="input" /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="ce-tags">Hashtags</label><input id="ce-tags" name="hashtags" value={tags} onChange={(e) => setTags(e.target.value)} className="input" /></div>
        <div><label className="label" htmlFor="ce-first">First comment <span className="font-normal text-muted">(optional)</span></label><input id="ce-first" name="firstComment" defaultValue={firstComment} maxLength={2200} className="input" /></div>
      </div>

      {platforms.length > 0 && (
        <div className="rounded-xl border border-border">
          <div className="flex flex-wrap gap-1 border-b border-border p-2" role="tablist" aria-label="Caption per platform">
            {platforms.map((p) => {
              const len = full(p).length, limit = CAPTION_LIMITS[p] ?? 63206, over = len > limit || countHashtags(full(p)) > (MAX_HASHTAGS[p] ?? 99);
              return (
                <button key={p} type="button" role="tab" aria-selected={open === p} onClick={() => setOpen(p)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${open === p ? "bg-primary/10 text-foreground" : "text-muted hover:bg-hover"}`}>
                  <PlatformDot code={PLATFORM_META[p]?.code ?? "?"} color={PLATFORM_META[p]?.color ?? "#6b7280"} size={18} />{PLATFORM_META[p]?.label ?? p}
                  <span className={over ? "text-brand" : "text-muted"}>{len}/{limit > 9999 ? "∞" : limit}</span>
                  {own[p]?.trim() ? <span className="rounded bg-primary/15 px-1 text-[10px]">own</span> : null}
                </button>
              );
            })}
          </div>
          {platforms.map((p) => (
            <div key={p} hidden={open !== p} className="grid gap-3 p-3 lg:grid-cols-2">
              <div>
                <label className="label" htmlFor={`pc-${p}`}>{PLATFORM_META[p]?.label ?? p} caption <span className="font-normal text-muted">(leave empty to use the main caption)</span></label>
                <textarea id={`pc-${p}`} name={`pc_${p}`} rows={5} value={own[p] ?? ""} onChange={(e) => setOwn((o) => ({ ...o, [p]: e.target.value }))} placeholder={main} className="input" />
                {(full(p).length > (CAPTION_LIMITS[p] ?? 63206)) && <p className="mt-1 text-xs text-brand">Too long for {PLATFORM_META[p]?.label}: {full(p).length} of {CAPTION_LIMITS[p]} characters with hashtags. It cannot go to the client like this.</p>}
                {countHashtags(full(p)) > (MAX_HASHTAGS[p] ?? 99) && <p className="mt-1 text-xs text-brand">{countHashtags(full(p))} hashtags; {PLATFORM_META[p]?.label} allows {MAX_HASHTAGS[p]}.</p>}
              </div>
              <div aria-label={`${PLATFORM_META[p]?.label} preview`} className="rounded-xl border border-border bg-surface p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 text-xs text-muted"><PlatformDot code={PLATFORM_META[p]?.code ?? "?"} color={PLATFORM_META[p]?.color ?? "#6b7280"} size={18} />Preview</div>
                <div className="mb-2 aspect-[4/3] rounded-lg bg-hover" aria-hidden />
                <Preview text={full(p)} fold={p === "INSTAGRAM" || p === "TIKTOK" ? 125 : p === "FACEBOOK" ? 480 : p === "LINKEDIN" ? 210 : 0} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shows where the platform cuts the caption behind "more"
function Preview({ text, fold }: { text: string; fold: number }) {
  const [more, setMore] = useState(false);
  if (!fold || text.length <= fold || more) return <p className="whitespace-pre-line break-words">{text}</p>;
  return <p className="whitespace-pre-line break-words">{text.slice(0, fold)}… <button type="button" onClick={() => setMore(true)} className="text-muted underline">more</button><span className="block text-xs text-muted">Viewers see this much before tapping “more”.</span></p>;
}
