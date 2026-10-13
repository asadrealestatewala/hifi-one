"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { STATUS_LABEL, TASK_STATUSES } from "@/lib/project-rules";
import { moveTask } from "../../projects/actions";

// Change a task's status from the list. The same rules apply as on the board (waiting-for tasks and open subtasks refuse with a reason).
export default function MyTaskStatus({ id, status, title }: { id: string; status: string; title: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div>
      <select aria-label={`Status of ${title}`} value={value} disabled={pending} className="input !w-36 !py-1 !text-xs" onChange={(e) => {
        const next = e.target.value, prev = value;
        setValue(next); setError("");
        start(async () => { const r = await moveTask(id, next); if (!r.ok) { setValue(prev); setError(r.error); } else router.refresh(); });
      }}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
      {error && <p role="alert" className="mt-1 max-w-48 text-[11px] text-brand">{error}</p>}
    </div>
  );
}
