"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveConversionAction, rejectConversionAction } from "../actions";
import { Notice } from "@/components/ui";

type Row = { id: string; leadId: string; lead: string; number: number; value: string | null; by: string; note: string | null; at: string };

export default function ApprovalRows({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function approve(r: Row) {
    if (!window.confirm(`Approve Closed Won for ${r.lead}? This converts the lead into a client.`)) return;
    start(async () => {
      const res = await approveConversionAction(r.id);
      setError(res.ok ? null : res.error);
      router.refresh();
    });
  }
  function reject(r: Row) {
    start(async () => {
      const res = await rejectConversionAction(r.id, reason);
      setError(res.ok ? null : res.error);
      if (res.ok) { setRejecting(null); setReason(""); }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && <Notice kind="error">{error}</Notice>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="card space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/leads/${r.leadId}`} className="font-semibold hover:underline">{r.lead}</Link> <span className="text-xs text-muted">L-{r.number}</span>
                <p className="text-sm text-muted">Asked by {r.by} · {r.at}{r.value ? ` · ${r.value}` : " · no deal value set"}</p>
                {r.note && <p className="mt-1 text-sm">{r.note}</p>}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn" disabled={pending} onClick={() => approve(r)}>Approve and convert</button>
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => setRejecting(rejecting === r.id ? null : r.id)}>Reject</button>
              </div>
            </div>
            {rejecting === r.id && (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); reject(r); }}>
                <div className="grow">
                  <label className="label" htmlFor={`reason-${r.id}`}>Reason for the agent</label>
                  <input id={`reason-${r.id}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required minLength={3} />
                </div>
                <button type="submit" className="btn" disabled={pending}>Send rejection</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
