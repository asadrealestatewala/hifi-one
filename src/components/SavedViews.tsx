import Link from "next/link";
import { deleteViewAction, saveViewAction } from "@/app/(app)/views/actions";
import { VIEW_LISTS, cleanQuery, type SavedView } from "@/lib/saved-views";
import { ConfirmButton, Notice, SubmitButton } from "@/components/ui";

// "My views": a row of the person's saved filter combinations, and a way to save the one on screen. Personal to the signed-in user.
export default function SavedViews({ list, views, current, error }: { list: string; views: SavedView[]; current: Record<string, string | undefined>; error?: string }) {
  const path = VIEW_LISTS[list].path;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v) q.set(k, v);
  const query = cleanQuery(list, q.toString());
  const active = views.find((v) => v.query === query);
  if (views.length === 0 && !query) return error ? <Notice kind="error">{error}</Notice> : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {error && <Notice kind="error">{error}</Notice>}
      {views.length > 0 && <span className="text-xs text-muted">My views</span>}
      {views.map((v) => (
        <span key={v.name} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${active?.name === v.name ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
          <Link href={`${path}${v.query ? `?${v.query}` : ""}`} className="hover:underline">{v.name}</Link>
          <form action={deleteViewAction}><input type="hidden" name="list" value={list} /><input type="hidden" name="name" value={v.name} />
            <ConfirmButton className="text-muted hover:text-foreground" title={`Remove the view “${v.name}”?`} message="Only the saved view is removed, not any data." confirmLabel="Remove"><span aria-hidden>×</span><span className="sr-only">Remove view {v.name}</span></ConfirmButton></form>
        </span>
      ))}
      {query && !active && (
        <details className="relative">
          <summary className="cursor-pointer text-xs text-primary">Save this view</summary>
          <form action={saveViewAction} className="absolute z-10 mt-1 flex w-64 items-end gap-2 rounded-xl border border-border bg-surface p-3 shadow-lg">
            <input type="hidden" name="list" value={list} /><input type="hidden" name="query" value={query} />
            <div className="flex-1"><label className="label" htmlFor={`view-name-${list}`}>Name</label><input id={`view-name-${list}`} name="name" required minLength={2} maxLength={40} className="input" /></div>
            <SubmitButton className="btn !py-1.5">Save</SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}
