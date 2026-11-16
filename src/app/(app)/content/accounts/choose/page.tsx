import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PLATFORM_META } from "@/lib/content-rules";
import { connectChoices, SocialError } from "@/lib/social-meta";
import { PageHeader, SubmitButton } from "@/components/ui";
import { PlatformDot } from "../../PostForm";
import { chooseAccountsAction } from "../actions";

export const dynamic = "force-dynamic";

// After Facebook sign-in: tick the Pages and Instagram accounts to connect for this client. The list lives 30 minutes.
export default async function ChooseAccounts({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const user = await requirePermission("content.publish");
  const { s = "" } = await searchParams;
  let data: Awaited<ReturnType<typeof connectChoices>>;
  try { data = await connectChoices(db, { organizationId: user.organizationId, userId: user.id, sessionId: s }); }
  catch (e) { if (e instanceof SocialError) redirect(`/content/accounts?error=${encodeURIComponent(e.message)}`); throw e; }
  const client = data.clientId ? await db.client.findFirst({ where: { id: data.clientId, organizationId: user.organizationId }, select: { name: true } }) : null;
  const pagesWithoutIg = data.choices.filter((c) => c.kind === "FACEBOOK" && !data.choices.some((x) => x.kind === "INSTAGRAM" && x.pageId === c.id));
  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader back={{ href: "/content/accounts", label: "Social accounts" }} title={`Choose accounts for ${client?.name ?? "our own posts"}`}
        subtitle="Tick only this client's accounts. Posts for this client can go only to the accounts connected here." />
      <form action={chooseAccountsAction} className="card space-y-3">
        <input type="hidden" name="s" value={s} />
        <ul className="divide-y divide-border">
          {data.choices.map((c) => (
            <li key={`${c.kind}:${c.id}`}>
              <label className="flex cursor-pointer items-center gap-3 py-2 text-sm">
                <input type="checkbox" name="pick" value={`${c.kind}:${c.id}`} />
                <PlatformDot code={PLATFORM_META[c.kind]?.code ?? "?"} color={PLATFORM_META[c.kind]?.color ?? "#6b7280"} size={20} />
                <span className="font-medium">{c.name}</span>{c.username && <span className="text-muted">@{c.username}</span>}
                <span className="ml-auto text-xs text-muted">{PLATFORM_META[c.kind]?.label}</span>
              </label>
            </li>
          ))}
        </ul>
        {pagesWithoutIg.length > 0 && <p className="text-xs text-muted">No Instagram account came with {pagesWithoutIg.map((p) => p.name).join(", ")}. To post to Instagram, switch it to a Business or Creator account, link it to the Page in Meta Business Suite, then connect again.</p>}
        <SubmitButton className="btn" pendingText="Connecting…">Connect ticked accounts</SubmitButton>
      </form>
    </div>
  );
}
