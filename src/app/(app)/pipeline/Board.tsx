"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { moveLead } from "../leads/actions";

type Stage = { id: string; name: string; isWon: boolean };
type Card = { id: string; stageId: string; name: string; company: string | null; value: string | null; days: number };

export default function Board({ stages, cards: initial, canEdit }: { stages: Stage[]; cards: Card[]; canEdit: boolean }) {
  const [cards, setCards] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [, start] = useTransition();

  function move(id: string, stageId: string) {
    const prev = cards;
    const card = cards.find((c) => c.id === id);
    if (!card || card.stageId === stageId) return;
    setCards(cards.map((c) => (c.id === id ? { ...c, stageId, days: 0 } : c))); // optimistic
    start(async () => {
      const r = await moveLead(id, stageId);
      if (!r.ok) {
        setCards(prev); // roll back to the saved state
        setError(r.error);
      } else {
        setError(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {stages.map((s) => {
          const col = cards.filter((c) => c.stageId === s.id);
          return (
            <section
              key={s.id}
              aria-label={s.name}
              className="w-64 shrink-0 rounded-xl bg-border/40 p-2"
              onDragOver={(e) => canEdit && e.preventDefault()}
              onDrop={() => dragId && move(dragId, s.id)}
            >
              <h2 className="px-1 py-1 text-xs font-semibold text-muted">{s.name} · {col.length}</h2>
              <div className="space-y-2 min-h-12">
                {col.map((c) => (
                  <article
                    key={c.id}
                    draggable={canEdit}
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => setDragId(null)}
                    className="card !p-3 cursor-grab text-sm space-y-1"
                  >
                    <Link href={`/leads/${c.id}`} className="font-semibold hover:underline">{c.name}</Link>
                    {c.company && <p className="text-xs text-muted">{c.company}</p>}
                    <p className="text-xs">{c.value ?? "No value set"} · {c.days}d in stage</p>
                    {canEdit && (
                      <select
                        aria-label={`Move ${c.name} to stage`}
                        className="input !py-1 !text-xs"
                        value={c.stageId}
                        onChange={(e) => move(c.id, e.target.value)}
                      >
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
