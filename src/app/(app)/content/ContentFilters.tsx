"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CONTENT_STATUSES, PLATFORMS, PLATFORM_META, POST_TYPES, POST_TYPE_LABEL } from "@/lib/content-rules";

type Opt = { id: string; name: string };
const label = (s: string) => s.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// Filters apply as you change them: the choice goes into the address (so a view can be shared) and the page updates.
export default function ContentFilters({ people, clients }: { people: Opt[]; clients: Opt[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    p.delete("new"); p.delete("error");
    router.replace(`/content${p.toString() ? `?${p}` : ""}`);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const active = ["q", "platform", "type", "status", "owner", "client"].filter((k) => sp.get(k)).length;
  const sel = "input !w-auto min-w-36";
  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter posts">
      <input value={q} onChange={(e) => { setQ(e.target.value); if (timer.current) clearTimeout(timer.current); const v = e.target.value; timer.current = setTimeout(() => set("q", v.trim()), 350); }} placeholder="Search…" aria-label="Search posts" className="input !w-56" />
      <select aria-label="Platform" value={sp.get("platform") ?? ""} onChange={(e) => set("platform", e.target.value)} className={sel}><option value="">All platforms</option>{PLATFORMS.filter((p) => p !== "OTHER").map((p) => <option key={p} value={p}>{PLATFORM_META[p].label}</option>)}</select>
      <select aria-label="Post type" value={sp.get("type") ?? ""} onChange={(e) => set("type", e.target.value)} className={sel}><option value="">All types</option>{POST_TYPES.map((t) => <option key={t} value={t}>{POST_TYPE_LABEL[t]}</option>)}</select>
      <select aria-label="Status" value={sp.get("status") ?? ""} onChange={(e) => set("status", e.target.value)} className={sel}><option value="">All statuses</option>{CONTENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      <select aria-label="Assigned to" value={sp.get("owner") ?? ""} onChange={(e) => set("owner", e.target.value)} className={sel}><option value="">Everyone</option><option value="none">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <select aria-label="Client" value={sp.get("client") ?? ""} onChange={(e) => set("client", e.target.value)} className={sel}><option value="">All clients</option><option value="none">Our own posts</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {active > 0 && <button type="button" onClick={() => { setQ(""); const p = new URLSearchParams(); for (const k of ["view", "m"]) if (sp.get(k)) p.set(k, sp.get(k)!); router.replace(`/content${p.toString() ? `?${p}` : ""}`); }} className="text-sm font-medium text-primary hover:underline">Clear filters ({active})</button>}
    </div>
  );
}
