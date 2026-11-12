import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import Icon from "@/components/shell/Icon";
import { PageHeader } from "@/components/ui";
import { settingsSections } from "@/components/shell/screen-groups";

export const dynamic = "force-dynamic";

// One way in to the fifteen setup screens, so Administration is three menu entries instead of nineteen.
// Only the screens this person may open are listed; each of them links back here.
export default async function Settings() {
  const user = await requireUser();
  const sections = settingsSections(user.permissions);
  if (sections.length === 0) redirect("/forbidden");
  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title="Settings" subtitle="How the system is set up: your company, your money, your email, your rules and the work that runs on its own." />
      <div className="space-y-4">
        {sections.map((s) => (
          <section key={s.title} className="card !p-0">
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon name={s.icon} className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block font-semibold">{s.title}</span><span className="block truncate text-xs text-muted">{s.what}</span></span>
            </header>
            <ul className="grid sm:grid-cols-2">
              {s.tabs.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm transition hover:bg-hover/60">
                    <span className="min-w-0 flex-1 truncate">{t.label}</span>
                    <Icon name="chevron" className="h-4 w-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
