"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import Icon from "@/components/shell/Icon";
import { updateContactSectionAction, type SectionName } from "./actions";
import { Notice } from "@/components/ui";

// One block of the contact page. Shows the details; the pencil turns the block into a small form that saves on its own,
// so each part of a contact is added or amended in place without leaving the page.
export default function EditableSection({ contactId, section, title, canEdit, view, children, wide }: {
  contactId: string; section: SectionName; title?: string; canEdit: boolean; view: ReactNode; children: ReactNode; wide?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError("");
    start(async () => {
      const r = await updateContactSectionAction(contactId, section, fd);
      if (r.ok) { setEditing(false); router.refresh(); } else setError(r.error ?? "Could not save.");
    });
  };
  return (
    <section className={`group/sec ${wide ? "" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        {title ? <h2 className="text-[15px] font-semibold">{title}</h2> : <span />}
        {canEdit && !editing && <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${title ?? section}`} className="rounded-lg p-1.5 text-muted opacity-60 transition hover:bg-hover hover:text-primary group-hover/sec:opacity-100"><Icon name="edit" className="h-4 w-4" /></button>}
      </div>
      {editing ? (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-primary/30 bg-surface p-4 shadow-sm [animation:fade_.15s_ease-out]">
          {error && <Notice kind="error">{error}</Notice>}
          {children}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => { setEditing(false); setError(""); }} disabled={pending}>Cancel</button><button className="btn" disabled={pending}>{pending ? "Saving…" : "Save"}</button></div>
        </form>
      ) : view}
    </section>
  );
}
