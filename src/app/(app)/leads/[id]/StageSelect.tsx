"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveLead } from "../actions";

export default function StageSelect({
  leadId,
  current,
  stages,
}: {
  leadId: string;
  current: string;
  stages: { id: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-1">
      <label className="label" htmlFor="stage">Move to stage</label>
      <select
        id="stage"
        className="input"
        value={current}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const r = await moveLead(leadId, e.target.value);
            setError(r.ok ? null : r.error);
            router.refresh();
          })
        }
      >
        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {error && <p role="alert" className="text-xs text-brand max-w-xs">{error}</p>}
    </div>
  );
}
