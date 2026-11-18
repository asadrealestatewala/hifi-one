"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveTask } from "../../projects/actions";

// One tick to finish a task, or to reopen one finished today. The board's rules still apply: a task waiting for
// another, or with open subtasks, refuses with the reason shown under it.
export default function QuickDone({ id, title, done }: { id: string; title: string; done: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(done);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-start">
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-wait"
        aria-label={done ? `Reopen ${title}` : `Mark ${title} done`}
        checked={checked}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setChecked(next); setError("");
          start(async () => {
            const r = await moveTask(id, next ? "DONE" : "TODO");
            if (!r.ok) { setChecked(!next); setError(r.error); } else router.refresh();
          });
        }}
      />
      {error && <p role="alert" className="mt-1 w-40 text-[11px] leading-tight text-brand">{error}</p>}
    </div>
  );
}
