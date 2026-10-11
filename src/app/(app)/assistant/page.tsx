import { requirePermission } from "@/lib/auth";
import { assistantConfigured, toolsFor } from "@/lib/assistant";
import AssistantChat from "./AssistantChat";

export const dynamic = "force-dynamic";

export default async function Assistant() {
  const user = await requirePermission("assistant.use");
  const connected = assistantConfigured();
  const tools = toolsFor(user.permissions);
  const examples = [
    ...(user.permissions.has("finance.view") ? ["Which invoices are overdue?"] : []),
    ...(user.permissions.has("reports.view") ? ["How are we doing this month?"] : []),
    ...(user.permissions.has("crm.view") ? ["Where is the sales pipeline?"] : []),
    ...(user.permissions.has("tasks.edit") ? ["What is on my plate?"] : []),
  ];
  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Assistant</h1>
      <p className="text-sm text-muted">Ask a question in plain words. The assistant can only read the same information you can open yourself, and it cannot change anything. Your question and the figures needed to answer it are sent to Anthropic&apos;s Claude service to write the answer. Questions are logged for audit.</p>
      {!connected && <p className="text-sm bg-amber-500/10 text-amber-700 rounded-lg px-3 py-2">Not connected. An administrator needs to set <code>ANTHROPIC_API_KEY</code> in the server environment. Until then, questions are not sent anywhere.</p>}
      {tools.length === 0 ? <div className="card text-sm text-muted">Your role has no information the assistant can read.</div> : <AssistantChat examples={examples.length ? examples : ["What can you tell me?"]} />}
      <details className="text-sm"><summary className="cursor-pointer text-muted">What it can read for you</summary>
        <ul className="mt-2 list-disc pl-5">{tools.map((t) => <li key={t.name}>{t.description}</li>)}</ul></details>
    </div>
  );
}
