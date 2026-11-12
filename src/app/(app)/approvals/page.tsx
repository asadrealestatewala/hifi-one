import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pendingApprovals, summarise, waitingFor } from "@/lib/approvals";
import Icon from "@/components/shell/Icon";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// One list of everything waiting for a decision from the reader. Each row links to the screen that owns the
// decision; nothing is decided here, so there is still one writer per fact.
export default async function Approvals() {
  const user = await requireUser();
  const now = new Date();
  const { groups, total } = summarise(await pendingApprovals(db, user));
  const onlyMine = !user.permissions.has("attendance.view_all") && user.permissions.has("leave.approve");
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title="Approvals"
        subtitle={`Everything waiting for your word, from every part of the system.${onlyMine ? " Leave and off-site days are shown for the people who report to you." : ""}`}
      />
      {total === 0 ? (
        <Empty title="Nothing is waiting for you">When somebody asks for leave, sends a voucher or needs a decision from you, it appears here and you are notified.</Empty>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">{total} thing{total === 1 ? "" : "s"} waiting, oldest first.</p>
          {groups.map((g) => (
            <section key={g.key} className="card !p-0">
              <header className="flex items-center gap-3 border-b border-border px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon name={g.icon} className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold">{g.label} <span className="rounded-full bg-brand/10 px-2 text-xs font-semibold leading-5 text-brand">{g.count}</span></span><span className="block truncate text-xs text-muted">{g.what}</span></span>
                <Link href={g.href} className="btn-ghost whitespace-nowrap">Open</Link>
              </header>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.id}>
                    <Link href={r.href} className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm transition last:border-0 hover:bg-hover/60">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{r.who ? <strong className="font-medium">{r.who}</strong> : null}{r.who ? " · " : ""}{r.title}</span>
                        <span className="block truncate text-xs text-muted">{[r.sub, waitingFor(r.since, now)].filter(Boolean).join(" · ")}</span>
                      </span>
                      <Icon name="chevron" className="h-4 w-4 text-muted" />
                    </Link>
                  </li>
                ))}
                {g.count > g.rows.length && <li className="px-4 py-2 text-xs text-muted">+ {g.count - g.rows.length} more</li>}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
