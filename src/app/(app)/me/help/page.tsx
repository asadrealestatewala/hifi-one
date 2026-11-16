import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { GROUPS, TASKS, TIPS } from "@/lib/help-content";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Help() {
  const user = await requireUser();
  const mine = TASKS.filter((t) => t.permission === null || user.permissions.has(t.permission));
  const groups = GROUPS.map(([id, title]) => ({ id, title, items: mine.filter((t) => t.group === id) })).filter((g) => g.items.length > 0);
  return (
    <div className="space-y-6">
      <PageHeader title="Help & guide" subtitle="Where to do the common jobs, and a few tips. You only see what your role allows." />
      {groups.map((g) => (
        <section key={g.id} className="space-y-3" aria-labelledby={`help-${g.id}`}>
          <h2 id={`help-${g.id}`} className="font-semibold">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((t) => (
              <Link key={t.title} href={t.href} className="card block !p-4 transition hover:ring-2 hover:ring-primary/30"><p className="font-semibold">{t.title}</p><p className="mt-1 text-sm text-muted">{t.why}</p></Link>
            ))}
          </div>
        </section>
      ))}
      <section className="card">
        <h2 className="mb-3 font-semibold">Good to know</h2>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">{TIPS.map(([k, v]) => <div key={k}><dt className="text-sm font-medium">{k}</dt><dd className="text-sm text-muted">{v}</dd></div>)}</dl>
      </section>
      <section className="card text-sm text-muted">
        <h2 className="mb-1 font-semibold text-foreground">Something not working?</h2>
        <p>If a page says you do not have access, your role does not include it; ask your manager or an administrator. If something looks wrong, note the page address and what you clicked, and tell your administrator.</p>
        <p className="mt-2">Your account: {user.name}, {user.roles.join(", ")}. <Link href="/account/security" className="text-primary hover:underline">Account security</Link> · <Link href="/me/profile" className="text-primary hover:underline">My profile</Link></p>
      </section>
    </div>
  );
}
