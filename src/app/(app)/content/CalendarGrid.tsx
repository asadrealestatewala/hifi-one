"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Avatar from "@/components/ui/Avatar";
import { PLATFORM_META, POST_TYPE_LABEL } from "@/lib/content-rules";
import { reschedulePostAction } from "./actions";
import { PlatformDot } from "./PostForm";
import { STATUS_STYLE } from "./status-style";
import { Notice } from "@/components/ui";

export type CalItem = { id: string; title: string; date: string; time: string | null; status: string; platforms: string[]; postType: string; client: string | null; assignee: string | null; assigneeId: string | null };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const MAX_SHOWN = 3;

// The month as a grid. Click a day to plan a post for it, click a post to open it, drag a post to another day to move it.
export default function CalendarGrid({ month, today, items: initial, canManage, newHrefBase }: { month: string; today: string; items: CalItem[]; canManage: boolean; newHrefBase: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [, start] = useTransition();

  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const gridStart = new Date(first); gridStart.setUTCDate(1 - first.getUTCDay());
  const weeks = Math.ceil((first.getUTCDay() + new Date(Date.UTC(y, m, 0)).getUTCDate()) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => { const d = new Date(gridStart); d.setUTCDate(gridStart.getUTCDate() + i); return d; });
  const byDay = new Map<string, CalItem[]>();
  for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it].sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99")));

  const drop = (date: string) => {
    const it = items.find((x) => x.id === dragId);
    setOver(null); setDragId(null);
    if (!it || it.date === date) return;
    const prev = items;
    setItems(items.map((x) => (x.id === it.id ? { ...x, date } : x)));
    setError("");
    start(async () => {
      const r = await reschedulePostAction(it.id, date);
      if (!r.ok) { setItems(prev); setError(r.error ?? "Could not move it."); } else router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      {error && <Notice kind="error">{error}</Notice>}
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 border-b border-border bg-hover/60 text-center text-xs font-medium text-muted">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = iso(d), inMonth = d.getUTCMonth() === m - 1, list = byDay.get(key) ?? [], isToday = key === today, all = expanded === key;
              return (
                <div key={key}
                  onDragOver={(e) => { if (canManage && dragId) { e.preventDefault(); setOver(key); } }} onDragLeave={() => setOver((o) => (o === key ? null : o))} onDrop={(e) => { e.preventDefault(); drop(key); }}
                  className={`group min-h-[120px] border-b border-r border-border p-1.5 transition ${inMonth ? "" : "bg-hover/40"} ${over === key ? "bg-primary/10 ring-2 ring-inset ring-primary/40" : ""}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs ${isToday ? "bg-primary font-semibold text-white" : inMonth ? "text-foreground" : "text-muted/60"}`}>{d.getUTCDate()}</span>
                    {canManage && <Link href={`${newHrefBase}${newHrefBase.includes("?") ? "&" : "?"}new=1&date=${key}`} aria-label={`Plan a post on ${key}`} className="rounded px-1.5 text-sm leading-5 text-muted opacity-0 transition hover:bg-hover hover:text-primary focus:opacity-100 group-hover:opacity-100">+</Link>}
                  </div>
                  <ul className="space-y-1">
                    {(all ? list : list.slice(0, MAX_SHOWN)).map((it) => {
                      const st = STATUS_STYLE[it.status] ?? STATUS_STYLE.DRAFT;
                      return (
                        <li key={it.id} draggable={canManage && it.status !== "PUBLISHED"} onDragStart={() => setDragId(it.id)} onDragEnd={() => { setDragId(null); setOver(null); }} className={dragId === it.id ? "opacity-40" : ""}>
                          <Link href={`/content/${it.id}`} title={`${it.title} · ${st.label}${it.client ? ` · ${it.client}` : ""} · ${POST_TYPE_LABEL[it.postType] ?? ""}`} className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] leading-tight transition hover:shadow-sm ${st.chip}`}>
                            <span className="flex -space-x-1">{it.platforms.slice(0, 3).map((p) => <PlatformDot key={p} code={PLATFORM_META[p]?.code ?? "?"} color={PLATFORM_META[p]?.color ?? "#6b7280"} size={14} />)}</span>
                            <span className="min-w-0 flex-1 truncate font-medium">{it.time ? `${it.time} ` : ""}{it.title}</span>
                            {it.assignee && <Avatar name={it.assignee} userId={it.assigneeId} size={14} />}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  {list.length > MAX_SHOWN && <button type="button" onClick={() => setExpanded(all ? null : key)} className="mt-1 w-full rounded px-1 text-left text-[11px] font-medium text-primary hover:underline">{all ? "Show fewer" : `+${list.length - MAX_SHOWN} more`}</button>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">{Object.entries(STATUS_STYLE).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm border ${v.chip}`} />{v.label}</span>)}{canManage && <span>Drag a post to another day to move it. Published posts stay put.</span>}</div>
    </div>
  );
}
