import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchAll } from "@/lib/search";

export const dynamic = "force-dynamic";

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("dashboard.view");
  const q = ((await searchParams).q ?? "").trim();
  const groups = await searchAll(db, { id: user.id, organizationId: user.organizationId, permissions: user.permissions }, q);
  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-bold">Search</h1>
      <form className="flex gap-2" role="search">
        <input name="q" defaultValue={q} aria-label="Search" placeholder="Client, lead, invoice number, project…" className="input" autoFocus />
        <button className="btn">Search</button>
      </form>
      {q.length > 0 && q.length < 2 && <p className="text-sm text-muted">Type at least two characters.</p>}
      {q.length >= 2 && groups.length === 0 && <div className="card text-sm text-muted">Nothing found for &quot;{q}&quot; among the records you can open.</div>}
      {groups.map((g) => (
        <section key={g.title} className="card">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">{g.title}</h2>
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
