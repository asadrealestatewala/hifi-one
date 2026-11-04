import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { INTEGRATIONS, keyStatuses } from "@/lib/integration-keys";
import { Badge, Notice, PageHeader, SubmitButton } from "@/components/ui";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { clearIntegrationKey, saveIntegrationKey } from "./actions";

export const dynamic = "force-dynamic";

export default async function Integrations({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("integrations.manage");
  const sp = await searchParams;
  const statuses = await keyStatuses(db, user.organizationId);
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Integrations" subtitle="API keys for outside services. Keys are stored encrypted and are never shown again after saving: you can only replace or remove them. Only a Super Admin can open this page." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {statuses.map((s) => {
        const info = INTEGRATIONS[s.provider];
        return (
          <section key={s.provider} className="card space-y-3" aria-label={info.label}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{info.label}</h2>
              <Badge tone={s.source ? "success" : "neutral"}>{s.source === "app" ? "Key saved in the app" : s.source === "server" ? "Key set on the server" : "No key"}</Badge>
            </div>
            <p className="text-sm text-muted">{info.usedFor}</p>
            {s.source === "app" && <p className="text-xs text-muted">Saved key ends in <code>{s.hint}</code>, last changed {s.updatedAt?.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. A saved key is not proof that the service accepts it: the first real use tells.</p>}
            {s.source === "server" && <p className="text-xs text-muted">Using the key in the server settings ({info.env}). A key saved here takes priority over it.</p>}
            {s.unreadable && <Notice kind="error">The saved key can no longer be read (the server&apos;s secret changed). Enter it again.</Notice>}
            <form action={saveIntegrationKey} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="provider" value={s.provider} />
              <div className="min-w-64 flex-1"><label className="label" htmlFor={`k-${s.provider}`}>{s.source === "app" ? "Replace key" : "API key"}</label>
                <input id={`k-${s.provider}`} name="value" type="password" autoComplete="off" spellCheck={false} required minLength={16} maxLength={400} placeholder="Paste the key" className="input font-mono" /></div>
              <SubmitButton pendingText="Saving…">{s.source === "app" ? "Replace" : "Save key"}</SubmitButton>
            </form>
            {s.source === "app" && (
              <form action={clearIntegrationKey}>
                <input type="hidden" name="provider" value={s.provider} />
                <ConfirmButton title={`Remove the ${info.label} key?`} message={`${info.label} features stop working until a key is entered again, unless a key is set on the server.`} confirmLabel="Remove key">Remove key</ConfirmButton>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
