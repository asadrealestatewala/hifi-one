"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import Icon from "@/components/shell/Icon";
import { bulkAction, quickUpdateAction } from "./actions";
import { ConfirmButton } from "@/components/ui";

export type Row = {
  id: string; name: string; kind: string; category: string; parentName: string | null; email: string | null; phone: string | null; ownerId: string | null; ownerName: string | null; tags: string[]; lastActivity: string | null;
};
type Opt = { id: string; name: string };

const TONE: Record<string, string> = { CUSTOMER: "bg-success/10 text-success", LEAD: "bg-primary/10 text-primary", PARTNER: "bg-warning/10 text-warning", VENDOR: "bg-hover text-muted", INVESTOR: "bg-hover text-muted", OTHER: "bg-hover text-muted" };
const PALETTE = ["#5648e8", "#0ea5e9", "#059669", "#d97706", "#e11d74", "#8b5cf6", "#0d9488", "#ea580c"];
const hue = (s: string) => PALETTE[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const ago = (iso: string | null) => { if (!iso) return "never"; const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`; };

function Inline({ id, field, value, canEdit, onSaved, onError }: { id: string; field: "phone" | "email"; value: string | null; canEdit: boolean; onSaved: (v: string) => void; onError: (m: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const save = () => {
    if (draft.trim() === (value ?? "")) { setEdit(false); return; }
    start(async () => { const r = await quickUpdateAction(id, field, draft.trim()); if (r.ok) { onSaved(draft.trim()); setEdit(false); } else { onError(r.error ?? "Could not save."); setDraft(value ?? ""); setEdit(false); } });
  };
  if (edit) return <input ref={ref} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value ?? ""); setEdit(false); } }} disabled={pending} aria-label={field === "phone" ? "Phone" : "Email"} className="input !py-1 text-xs" />;
  return (
    <span className="group/c flex items-center gap-1.5">
      <span className="truncate">{value ?? <span className="text-muted">—</span>}</span>
      {canEdit && <button type="button" onClick={() => { setDraft(value ?? ""); setEdit(true); }} aria-label={`Edit ${field}`} className="rounded p-0.5 text-muted opacity-0 transition hover:text-primary group-hover/c:opacity-100 focus:opacity-100"><Icon name="settings" className="h-3.5 w-3.5" /></button>}
    </span>
  );
}

export default function ContactsTable({ rows: initial, staff, canEdit, canAssign, returnTo, sortLinks }: { rows: Row[]; staff: Opt[]; canEdit: boolean; canAssign: boolean; returnTo: string; sortLinks: Record<string, { href: string; dir: "asc" | "desc" | null }> }) {
  const [rows, setRows] = useState(initial);
  const [sel, setSel] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const all = rows.length > 0 && sel.length === rows.length;
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const patch = (id: string, p: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const head = (key: string, label: string) => { const l = sortLinks[key]; return <Link href={l.href} className="inline-flex items-center gap-1 hover:text-foreground">{label}{l.dir && <span aria-hidden>{l.dir === "asc" ? "▲" : "▼"}</span>}</Link>; };
  const ids = sel.map((id) => <input key={id} type="hidden" name="ids" value={id} />);

  return (
    <div className="space-y-3">
      {toast && <p role="status" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{toast}</p>}
      {sel.length > 0 && canEdit && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm shadow-sm [animation:fade_.15s_ease-out]">
          <strong>{sel.length} selected</strong>
          {canAssign && <form action={bulkAction} className="flex items-center gap-1.5"><input type="hidden" name="action" value="ASSIGN" /><input type="hidden" name="returnTo" value={returnTo} />{ids}<select name="value" aria-label="Assign to" className="input !w-40 !py-1"><option value="">Assign to…</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select><button className="btn-ghost !py-1">Apply</button></form>}
          <form action={bulkAction} className="flex items-center gap-1.5"><input type="hidden" name="action" value="CATEGORY" /><input type="hidden" name="returnTo" value={returnTo} />{ids}<select name="value" aria-label="Set category" className="input !w-36 !py-1"><option value="">Category…</option>{["LEAD", "CUSTOMER", "PARTNER", "VENDOR", "INVESTOR", "OTHER"].map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}</select><button className="btn-ghost !py-1">Apply</button></form>
          <form action={bulkAction} className="flex items-center gap-1.5"><input type="hidden" name="action" value="TAG" /><input type="hidden" name="returnTo" value={returnTo} />{ids}<input name="value" placeholder="Add tag" aria-label="Tag to add" maxLength={30} className="input !w-28 !py-1" /><button className="btn-ghost !py-1">Tag</button></form>
          <form action={bulkAction}><input type="hidden" name="action" value="ARCHIVE" /><input type="hidden" name="returnTo" value={returnTo} />{ids}<ConfirmButton className="btn-ghost !py-1" title="Archive the selected contacts?" message="They leave lists and search. History is kept and an administrator can restore them." confirmLabel="Archive">Archive</ConfirmButton></form>
          <button type="button" onClick={() => setSel([])} className="ml-auto text-xs text-muted hover:text-foreground">Clear</button>
        </div>
      )}

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr>
              <th className="w-10 px-4 py-3"><input type="checkbox" checked={all} onChange={() => setSel(all ? [] : rows.map((r) => r.id))} aria-label="Select all" /></th>
              <th className="py-3 pr-4">{head("name", "Name")}</th><th className="pr-4">Phone</th><th className="pr-4">Email</th><th className="pr-4">{head("owner", "Owner")}</th><th className="pr-4">Tags</th><th className="pr-4">{head("activity", "Last activity")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-border ${sel.includes(r.id) ? "!bg-primary/5" : ""}`}>
                <td className="px-4 py-3"><input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
                <td className="py-3 pr-4">
                  <Link href={`/contacts/${r.id}`} className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: hue(r.name) }}>{r.kind === "ORGANIZATION" ? <Icon name="building" className="h-4 w-4" /> : initials(r.name)}</span>
                    <span className="min-w-0"><span className="block truncate font-medium hover:underline">{r.name}</span><span className="flex items-center gap-1.5 text-xs"><span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${TONE[r.category] ?? TONE.OTHER}`}>{r.category.charAt(0) + r.category.slice(1).toLowerCase()}</span>{r.parentName && <span className="truncate text-muted">{r.parentName}</span>}</span></span>
                  </Link>
                </td>
                <td className="max-w-48 pr-4"><Inline id={r.id} field="phone" value={r.phone} canEdit={canEdit} onSaved={(v) => patch(r.id, { phone: v || null })} onError={flash} /></td>
                <td className="max-w-56 pr-4"><Inline id={r.id} field="email" value={r.email} canEdit={canEdit} onSaved={(v) => patch(r.id, { email: v || null })} onError={flash} /></td>
                <td className="pr-4">{r.ownerName ? <span className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">{initials(r.ownerName)}</span><span className="hidden xl:inline">{r.ownerName}</span></span> : <span className="text-muted">Not set</span>}</td>
                <td className="pr-4"><span className="flex flex-wrap gap-1">{r.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full bg-hover px-1.5 py-px text-[10px] text-muted">{t}</span>)}{r.tags.length > 3 && <span className="text-[10px] text-muted">+{r.tags.length - 3}</span>}</span></td>
                <td className="pr-4 text-xs text-muted">{ago(r.lastActivity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
