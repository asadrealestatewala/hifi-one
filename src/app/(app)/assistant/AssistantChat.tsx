"use client";

import { useActionState } from "react";
import { askAssistant, type AssistantState } from "./actions";
import { Notice } from "@/components/ui";

const LABEL: Record<string, string> = {
  receivables_summary: "money owed by clients", overdue_invoices: "overdue invoices", profit_this_month: "this month's profit", sales_pipeline: "the sales pipeline", project_status: "project status", my_open_tasks: "your tasks",
};

export default function AssistantChat({ examples }: { examples: string[] }) {
  const [state, action, pending] = useActionState<AssistantState, FormData>(askAssistant, {});
  return (
    <div className="space-y-4">
      <form action={action} className="card space-y-3">
        <label className="label" htmlFor="question">Your question</label>
        <textarea id="question" name="question" rows={3} required minLength={3} maxLength={1000} defaultValue={state.question} className="input" placeholder={examples[0]} />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" disabled={pending}>{pending ? "Thinking…" : "Ask"}</button>
          <span className="text-xs text-muted">Try: {examples.join(" · ")}</span>
        </div>
      </form>
      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.answer && (
        <section className="card space-y-2" aria-live="polite">
          <p className="text-sm whitespace-pre-line">{state.answer}</p>
          {state.tools && state.tools.length > 0 && <p className="text-xs text-muted">Based on: {[...new Set(state.tools)].map((t) => LABEL[t] ?? t).join(", ")}, as you can see it today.</p>}
        </section>
      )}
    </div>
  );
}
