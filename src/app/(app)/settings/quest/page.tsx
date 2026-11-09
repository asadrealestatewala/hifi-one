import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getQuestSettings } from "@/lib/crm-contacts";
import { DEFAULT_QUEST, FIELD_KEYS, FIELD_LABELS } from "@/lib/quest";
import { Notice, PageHeader, SubmitButton } from "@/components/ui";
import { saveQuestSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function QuestSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("crm.quest_settings");
  const sp = await searchParams;
  const [s, roles] = await Promise.all([getQuestSettings(db, user.organizationId), db.role.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" }, select: { key: true, name: true } })]);
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Sales quest" subtitle="Daily goals, XP and levels shown on the sales card. Only contacts with a phone number count, short notes earn nothing, and the daily cap stops XP farming. Days run on Pakistan time and the streak skips weekends (Saturday and Sunday) and the holidays below. Only a Super Admin can open this page." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <form action={saveQuestSettings} className="space-y-5">
        <section className="card space-y-3">
          <h2 className="font-semibold">Everyone (default)</h2>
          <p className="text-sm text-muted">Leave a box empty to keep the built-in value shown in brackets.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELD_KEYS.map((k) => (
              <div key={k}><label className="label" htmlFor={k}>{FIELD_LABELS[k]} ({DEFAULT_QUEST[k]})</label>
                <input id={k} name={k} inputMode="numeric" className="input" defaultValue={s.base[k] ?? ""} /></div>
            ))}
          </div>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Different numbers for a role</h2>
          <p className="text-sm text-muted">For example field agents can have a visit goal and a lower contact goal. Empty means the default above. A person with several roles uses the first role (by key) that has any number here.</p>
          {roles.map((r) => (
            <details key={r.key} className="rounded-md border border-border p-3" open={!!s.roles[r.key]}>
              <summary className="cursor-pointer text-sm font-medium">{r.name}</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {FIELD_KEYS.map((k) => (
                  <div key={k}><label className="label" htmlFor={`r:${r.key}:${k}`}>{FIELD_LABELS[k]}</label>
                    <input id={`r:${r.key}:${k}`} name={`r:${r.key}:${k}`} inputMode="numeric" className="input" defaultValue={s.roles[r.key]?.[k] ?? ""} /></div>
                ))}
              </div>
            </details>
          ))}
        </section>
        <section className="card space-y-2">
          <h2 className="font-semibold">Public holidays</h2>
          <label className="label" htmlFor="holidays">One date per line, written YYYY-MM-DD. A holiday never breaks a streak.</label>
          <textarea id="holidays" name="holidays" rows={5} className="input" defaultValue={s.holidays.join("\n")} />
        </section>
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </form>
    </div>
  );
}
