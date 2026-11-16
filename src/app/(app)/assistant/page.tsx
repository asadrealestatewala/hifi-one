import { requirePermission } from "@/lib/auth";
import { toolsFor } from "@/lib/assistant";
import AssistantPanel from "@/components/shell/AssistantPanel";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Assistant() {
  const user = await requirePermission("assistant.use");
  const tools = toolsFor(user.permissions);
  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Assistant" subtitle="Ask a question in plain words, or ask how to do something. The assistant can only read the same information you can open yourself, and it cannot change anything. Your question and the figures needed to answer it are sent to Anthropic's Claude service to write the answer. Questions are logged for audit." />
      <AssistantPanel />
      <details className="text-sm"><summary className="cursor-pointer text-muted">What it can read for you</summary>
        <ul className="mt-2 list-disc pl-5">{tools.map((t) => <li key={t.name}>{t.description}</li>)}</ul></details>
    </div>
  );
}
