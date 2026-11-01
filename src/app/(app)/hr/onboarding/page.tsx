import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, ConfirmButton, Empty, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { decideOnboardingAction, resendCodeAction } from "./actions";

export const dynamic = "force-dynamic";

const LABEL: Record<string, { text: string; tone: "warning" | "primary" | "success" | "neutral" }> = {
  PENDING_VERIFICATION: { text: "waiting for their code", tone: "warning" }, PENDING_APPROVAL: { text: "waiting for approval", tone: "primary" },
  APPROVED: { text: "approved", tone: "success" }, REJECTED: { text: "rejected", tone: "neutral" },
};
const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "");

export default async function OnboardingApprovals({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("hr.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canDecide = user.permissions.has("onboarding.approve");
  const canResend = user.permissions.has("hr.manage");
  const [open, recent] = await Promise.all([
    db.onboardingRequest.findMany({ where: { organizationId: org, status: { in: ["PENDING_APPROVAL", "PENDING_VERIFICATION"] } }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] }),
    db.onboardingRequest.findMany({ where: { organizationId: org, status: { in: ["APPROVED", "REJECTED"] } }, orderBy: { decidedAt: "desc" }, take: 20 }),
  ]);
  const ids = [...new Set([...open, ...recent].flatMap((r) => [r.userId, r.requestedById, r.decidedById]).filter(Boolean) as string[])];
  const people = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, emailVerifiedAt: true, roles: { select: { role: { select: { name: true } } } }, employeeProfile: { select: { id: true, designation: true } } } })).map((u) => [u.id, u]));
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Onboarding approvals" subtitle="New staff accounts cannot sign in until the person enters the code we emailed them and someone with approval rights accepts the account. Accounts made before this existed are not affected." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <section className="card !p-0 overflow-x-auto">
        <h2 className="px-4 pt-4 font-semibold">Waiting</h2>
        {open.length === 0 ? <div className="p-4"><Empty title="Nobody is waiting">New accounts from the Staff Directory or Users screen show up here.</Empty></div> : (
          <ul className="mt-2 divide-y divide-border">{open.map((r) => {
            const u = people.get(r.userId);
            const self = r.requestedById === user.id && !user.roleKeys.includes("SUPER_ADMIN");
            return (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{u?.employeeProfile ? <Link className="hover:underline" href={`/hr/employees/${u.employeeProfile.id}`}>{u.name}</Link> : u?.name} <Badge tone={LABEL[r.status].tone}>{LABEL[r.status].text}</Badge></p>
                  <p className="text-muted">{u?.email ?? "No email"}{u?.emailVerifiedAt ? " · email verified" : ""} · {u?.roles.map((x) => x.role.name).join(", ")}{u?.employeeProfile?.designation ? ` · ${u.employeeProfile.designation}` : ""}</p>
                  <p className="text-xs text-muted">Added {when(r.createdAt)} UTC by {people.get(r.requestedById ?? "")?.name ?? "someone"}{r.lastCodeAt ? ` · last code sent ${when(r.lastCodeAt)} UTC` : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canResend && r.status === "PENDING_VERIFICATION" && u?.email && (
                    <form action={resendCodeAction}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn-ghost" pendingText="Sending…">Send a new code</SubmitButton></form>
                  )}
                  {canDecide && r.status === "PENDING_APPROVAL" && (self
                    ? <span className="text-xs text-muted">You added this person, so someone else approves.</span>
                    : <form action={decideOnboardingAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><SubmitButton pendingText="Approving…">Approve</SubmitButton></form>)}
                  {canDecide && r.userId !== user.id && (
                    <form action={decideOnboardingAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" />
                      <ConfirmButton title={`Reject ${u?.name ?? "this account"}?`} message="The account is switched off and the person is told by email. Their record is kept." confirmLabel="Reject" reason>Reject</ConfirmButton>
                    </form>
                  )}
                </div>
              </li>
            );
          })}</ul>
        )}
        {!canDecide && open.length > 0 && <p className="px-4 pb-3 text-xs text-muted">Only people with the &quot;Approve new staff accounts&quot; permission can approve.</p>}
      </section>
      {recent.length > 0 && (
        <section className="card !p-0 overflow-x-auto">
          <h2 className="px-4 pt-4 font-semibold">Recently decided</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">Person</th><th className="pr-4">Decision</th><th className="pr-4">By</th><th className="pr-4">When (UTC)</th><th className="pr-4">Note</th></tr></thead>
            <tbody>{recent.map((r) => (
              <tr key={r.id} className="border-t border-border"><td className="px-4 py-2">{people.get(r.userId)?.name}</td><td className="pr-4"><Badge tone={LABEL[r.status].tone}>{LABEL[r.status].text}</Badge></td><td className="pr-4">{people.get(r.decidedById ?? "")?.name}</td><td className="pr-4 whitespace-nowrap">{when(r.decidedAt)}</td><td className="pr-4">{r.decisionNote}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
