"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { moveLead } from "../leads/actions";
import { Notice } from "@/components/ui";

type Stage = { id: string; name: string; isWon: boolean; probability: number };
type Card = {
  id: string; stageId: string; name: string; company: string | null; value: string | null; days: number; owner: string | null; campaign: string | null;
  followUp: string | null; overdue: boolean; score: number; service: string | null;
};

const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export default function Board({ stages, cards: initial, canEdit, totals }: { stages: Stage[]; cards: Card[]; canEdit: boolean; totals: Record<string, string> }) {
  const [cards, setCards] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [, start] = useTransition();

  function move(id: string, stageId: string) {
    const prev = cards;
    const card = cards.find((c) => c.id === id);
    if (!card || card.stageId === stageId) return;
    setCards(cards.map((c) => (c.id === id ? { ...c, stageId, days: 0 } : c))); // optimistic
    start(async () => {
      const r = await moveLead(id, stageId);
      if (!r.ok) { setCards(prev); setError(r.error); } else setError(null); // a failed move rolls back to the saved state
    });
  }

  return (
    <div className="space-y-3">
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((s) => {
          const col = cards.filter((c) => c.stageId === s.id);
          return (
            <section key={s.id} aria-label={s.name}
              className={`w-72 shrink-0 rounded-2xl p-2 transition-colors ${over === s.id ? "bg-primary/10 ring-2 ring-primary/30" : "bg-hover"}`}
              onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(s.id); } }} onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={() => { setOver(null); if (dragId) move(dragId, s.id); }}>
              <header className="flex items-center justify-between px-2 pb-2 pt-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide">{s.name} <span className="ml-1 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">{col.length}</span></h2>
                <span className="text-[11px] text-muted">{s.probability}%{totals[s.id] ? ` · ${totals[s.id]}` : ""}</span>
              </header>
              <div className="min-h-12 space-y-2">
                {col.map((c) => (
                  <article key={c.id} draggable={canEdit} onDragStart={() => setDragId(c.id)} onDragEnd={() => { setDragId(null); setOver(null); }}
                    className="cursor-grab space-y-2 rounded-xl border border-border bg-surface p-3 text-sm shadow-sm transition hover:shadow-md active:cursor-grabbing">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><Link href={`/leads/${c.id}`} className="block truncate font-semibold hover:underline">{c.name}</Link>{c.company && <p className="truncate text-xs text-muted">{c.company}</p>}</div>
                      {c.owner && <span title={c.owner} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">{initials(c.owner)}</span>}
                    </div>
                    <p className="font-medium">{c.value ?? <span className="text-xs font-normal text-muted">No value set</span>}</p>
                    {(c.service || c.campaign) && <p className="truncate text-xs text-muted">{[c.service, c.campaign].filter(Boolean).join(" · ")}</p>}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                      <span>{c.days}d in stage</span>
                      <span className={c.overdue ? "font-medium text-brand" : ""}>{c.followUp ? `Follow-up ${c.followUp}` : "No follow-up"}</span>
                      <span title="Lead score">Score {c.score}</span>
                    </div>
                    {canEdit && (
                      <select aria-label={`Move ${c.name} to stage`} className="input !py-1 !text-xs" value={c.stageId} onChange={(e) => move(c.id, e.target.value)}>
                        {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </select>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
