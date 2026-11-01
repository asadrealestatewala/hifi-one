import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { SYSTEM_TEMPLATES } from "@/lib/email-templates";
import { mailConfig } from "@/lib/mailer";
import { Badge, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EmailTemplates() {
  const user = await requirePermission("email_templates.manage");
  const [edited, followUps] = await Promise.all([
    db.emailTemplate.findMany({ where: { organizationId: user.organizationId, kind: "SYSTEM" }, select: { key: true, updatedAt: true } }),
    db.emailTemplate.count({ where: { organizationId: user.organizationId, kind: "FOLLOW_UP", archived: false } }),
  ]);
  const when = new Map(edited.map((e) => [e.key, e.updatedAt]));
  const groups = ["Staff", "Clients"] as const;
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Email templates" subtitle="The branded emails Hifi One sends. Change the wording, preview it on desktop and phone, and send yourself a test. Layout, logo and company details stay consistent." />
      {!mailConfig().transportReady && <p className="card text-sm text-amber-700">Email is not connected yet, so these emails are logged as not sent. Connect it under <Link className="underline" href="/settings/email">Settings › Email</Link>.</p>}
      {groups.map((g) => (
        <section key={g} className="card !p-0 overflow-hidden">
          <h2 className="px-4 pt-4 font-semibold">{g === "Staff" ? "To staff" : "To clients"}</h2>
          <ul className="mt-2 divide-y divide-border">
            {SYSTEM_TEMPLATES.filter((t) => t.audience === g).map((t) => (
              <li key={t.key}>
                <Link href={`/settings/email-templates/${t.key}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-hover/50">
                  <span className="min-w-0"><span className="block font-medium">{t.name}</span><span className="block text-sm text-muted">{t.description}</span></span>
                  {when.has(t.key) ? <Badge tone="primary">edited {when.get(t.key)!.toISOString().slice(0, 10)}</Badge> : <Badge>default wording</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="card flex flex-wrap items-center justify-between gap-3 text-sm">
        <div><h2 className="font-semibold">Follow-up emails to leads</h2><p className="text-muted">{followUps} follow-up template{followUps === 1 ? "" : "s"}. They are written and timed with the sequences they belong to.</p></div>
        <Link className="btn-ghost" href="/leads/follow-ups">Open follow-up sequences</Link>
      </section>
    </div>
  );
}
