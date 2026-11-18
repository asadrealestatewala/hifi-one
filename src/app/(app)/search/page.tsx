import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchAll } from "@/lib/search";
import { destinations, matchDestinations } from "@/lib/go-to";
import { PageHeader } from "@/components/ui";
import RecordIcon from "@/components/ui/RecordIcon";
import { recordTypeFromTitle } from "@/lib/tint";

export const dynamic = "force-dynamic";

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("dashboard.view");
  const q = ((await searchParams).q ?? "").trim();
  const groups = await searchAll(db, { id: user.id, organizationId: user.organizationId, permissions: user.permissions }, q);
  // Screens and tabs first: someone typing "projects" or "holidays" usually wants a screen, not a record
  const pages = q ? matchDestinations(destinations(user.permissions), q, 12) : [];
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title="Search" />
      <form className="flex gap-2" role="search">
        <input name="q" defaultValue={q} aria-label="Search" placeholder="A screen or setting, or a client, lead, invoice number, project…" className="input" autoFocus />
        <button className="btn">Search</button>
      </form>
      {q.length > 0 && q.length < 2 && pages.length === 0 && <p className="text-sm text-muted">Type at least two characters.</p>}
      {pages.length > 0 && (
        <section className="card">
          <h2 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><RecordIcon type={null} size="sm" fallback="menu" />Go to</h2>
          <ul className="text-sm">
            {pages.map((p) => (
              <li key={p.href + p.label} className="border-t border-border first:border-0"><Link href={p.href} className="flex flex-wrap justify-between gap-2 py-2 hover:underline"><span className="font-medium">{p.label}</span><span className="text-muted">{p.trail.join(" → ")}</span></Link></li>
            ))}
          </ul>
        </section>
      )}
      {q.length >= 2 && groups.length === 0 && pages.length === 0 && <div className="card text-sm text-muted">Nothing found for &quot;{q}&quot; among the screens and records you can open.</div>}
      {q.length >= 2 && groups.length === 0 && pages.length > 0 && <p className="text-sm text-muted">No records match &quot;{q}&quot;.</p>}
      {groups.map((g) => (
        <section key={g.title} className="card">
          <h2 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><RecordIcon type={recordTypeFromTitle(g.title)} size="sm" fallback="search" />{g.title}</h2>
          <ul className="text-sm">
            {g.hits.map((h) => (
              <li key={h.href} className="border-t border-border first:border-0"><Link href={h.href} className="flex flex-wrap justify-between gap-2 py-2 hover:underline"><span className="font-medium">{h.label}</span>{h.sub && <span className="text-muted">{h.sub}</span>}</Link></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
