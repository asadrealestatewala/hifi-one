"use client";

import { useState } from "react";
import { PLATFORMS, PLATFORM_META, POST_TYPES, POST_TYPE_LABEL } from "@/lib/content-rules";
import { createPostAction } from "./actions";

type Opt = { id: string; name: string };

export function PlatformDot({ code, color, size = 22 }: { code: string; color: string; size?: number }) {
  return <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}>{code}</span>;
}

// "Plan a post": type, caption, platforms (tap to select), date and time, client and owner. Saved as a draft.
export default function PostForm({ clients, people, defaultDate, closeTo, error }: { clients: Opt[]; people: Opt[]; defaultDate: string; closeTo: string; error?: string }) {
  const [type, setType] = useState<string>("STATIC");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const toggle = (p: string) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  return (
    <form action={createPostAction} className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {error && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{error}</p>}
        <div><label className="label" htmlFor="pf-title">Title <span className="text-brand">*</span></label><input id="pf-title" name="title" required maxLength={200} autoFocus placeholder="e.g. Expert City: plots now open" className="input" /></div>

        <fieldset><legend className="label">Post type</legend>
          <div className="flex flex-wrap gap-2">
            {POST_TYPES.map((t) => (
              <label key={t} className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${type === t ? "border-primary bg-primary text-white shadow" : "border-border bg-surface hover:border-primary/40"}`}>
                <input type="radio" name="postType" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />{POST_TYPE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>

        <div><label className="label" htmlFor="pf-copy">Caption <span className="font-normal text-muted">({caption.length} characters)</span></label><textarea id="pf-copy" name="copy" rows={5} maxLength={5000} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write the caption with #hashtags and @mentions" className="input" /></div>

        <fieldset><legend className="label">Platforms <span className="font-normal text-muted">(tap to select{platforms.length > 0 ? `, ${platforms.length} chosen` : ""})</span></legend>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.filter((p) => p !== "OTHER").map((p) => {
              const m = PLATFORM_META[p], on = platforms.includes(p);
              return (
                <label key={p} className={`flex cursor-pointer items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm font-medium transition ${on ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border bg-surface hover:border-primary/40"}`}>
                  <input type="checkbox" name="platforms" value={p} checked={on} onChange={() => toggle(p)} className="sr-only" /><PlatformDot code={m.code} color={m.color} />{m.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="pf-date">Posting date <span className="text-brand">*</span></label><input id="pf-date" name="plannedDate" type="date" required defaultValue={defaultDate} className="input" /></div>
          <div><label className="label" htmlFor="pf-time">Posting time</label><input id="pf-time" name="plannedTime" type="time" defaultValue="18:00" className="input" /></div>
          <div><label className="label" htmlFor="pf-client">Client</label><select id="pf-client" name="clientId" className="input" defaultValue=""><option value="">Our own account (no client)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="pf-as">Assigned to</label><select id="pf-as" name="assignedToId" className="input" defaultValue=""><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="pf-tags">Hashtags</label><input id="pf-tags" name="hashtags" maxLength={500} className="input" /></div>
        </div>
        <p className="text-xs text-muted">Saved as a draft. Add the creative (images, video) on the next page, then send it for review. Posts for a client go to the client for approval; our own posts are approved internally.</p>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
        <a href={closeTo} className="btn-ghost">Close</a><button className="btn" disabled={platforms.length === 0} title={platforms.length === 0 ? "Choose at least one platform" : undefined}>Save post</button>
      </footer>
    </form>
  );
}
