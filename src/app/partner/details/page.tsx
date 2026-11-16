import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { signDownload } from "@/lib/files";
import {
  ACCOUNT_FIELD, DOCUMENTS, ID_TYPES, ID_TYPE_LABEL, IDENTITY_STATE_LABEL, IDENTITY_TONE, PAYOUT_METHODS, PAYOUT_METHOD_LABEL, PAYOUT_STATE_LABEL, PAYOUT_TONE,
  documentsFor, identityState, masked, payoutState,
} from "@/lib/partner-identity";
import { partnerId } from "@/lib/partner-stack";
import { Badge, Empty, Notice, PageHeader } from "@/components/ui";
import ConfirmButton from "@/components/ui/ConfirmButton";
import SubmitButton from "@/components/ui/SubmitButton";
import { IdentityFields, PayoutFields } from "@/components/PartnerIdentityFields";
import { addPayoutAction, defaultPayoutAction, removePayoutAction, submitIdentityAction } from "./actions";

export const dynamic = "force-dynamic";
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" });
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// The partner's own identity check and payout accounts. Everything is read for the earner bound to the signed-in partner.
export default async function PartnerDetails({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { user, earner } = await requirePartnerUser();
  const sp = await searchParams;
  const now = new Date();
  const [identity, docs, accounts] = await Promise.all([
    db.partnerIdentity.findUnique({ where: { earnerId: earner.id } }),
    documentsFor(db, user.organizationId, earner.id),
    db.partnerPayoutAccount.findMany({ where: { earnerId: earner.id, removedAt: null }, orderBy: { createdAt: "asc" } }),
  ]);
  const st = identityState(identity, now);
  const secret = process.env.SESSION_SECRET ?? "";
  const saved = docs.map((f) => ({ key: f.category ?? "", name: f.filename, href: `/api/partner-identity/${f.id}?t=${signDownload(f.id, user.id, secret)}` }));
  return (
    <>
      <PageHeader title="My details" subtitle={`Partner ID ${partnerId(earner.partnerNumber)}. Your identity check and where Hifi sends your payouts.`} />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <section id="identity" className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Identity check</h2>
          <Badge tone={IDENTITY_TONE[st]}>{IDENTITY_STATE_LABEL[st]}</Badge>
        </div>
        <p className="text-sm text-muted">We check every partner&rsquo;s identity before paying commissions or starting resale billing, as banks and partner programmes do. Training does not need it. Your ID number and pictures are stored privately; only two people at Hifi can open them, and every view is logged.</p>
        {identity && (
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted">Legal name</dt><dd>{identity.legalName}</dd>
            <dt className="text-muted">ID</dt><dd>{ID_TYPE_LABEL[identity.idType]} · {masked(identity.idLast4)}</dd>
            {identity.businessName && <><dt className="text-muted">Business</dt><dd>{identity.businessName}{identity.ntn && ` · NTN ${identity.ntn}`}</dd></>}
            {st === "VERIFIED" && identity.recheckDueAt && <><dt className="text-muted">Next yearly check</dt><dd>{day(identity.recheckDueAt)}</dd></>}
          </dl>
        )}
        {st === "REJECTED" && identity?.rejectReason && <Notice kind="error">Please correct this and send again: {identity.rejectReason}</Notice>}
        {st === "SUBMITTED" ? (
          <p className="text-sm">Thank you. Hifi is checking your details and will email you the result.</p>
        ) : (
          <details open={st === "NOT_SUBMITTED" || st === "REJECTED" || st === "RECHECK_DUE"} className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">{st === "NOT_SUBMITTED" ? "Send your details" : st === "VERIFIED" ? "Update your details (Hifi checks them again)" : "Correct and send again"}</summary>
            <form action={submitIdentityAction} className="mt-3 space-y-3">
              <IdentityFields
                idTypes={ID_TYPES} documents={DOCUMENTS} saved={saved} last4={identity?.idLast4 ?? null}
                initial={{ legalName: identity?.legalName ?? earner.name, idType: identity?.idType ?? (earner.country && !/pakistan/i.test(earner.country) ? "PASSPORT" : "CNIC"), businessName: identity?.businessName ?? "", ntn: identity?.ntn ?? "", secpNumber: identity?.secpNumber ?? "", activeTaxpayer: identity?.activeTaxpayer ?? false, address: identity?.address ?? "" }}
              />
              <SubmitButton pendingText="Sending…">Send for checking</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <section id="payouts" className="card !p-0 overflow-hidden">
        <div className="space-y-1 p-4">
          <h2 className="font-semibold">Payout accounts</h2>
          <p className="text-sm text-muted">Where Hifi sends your commissions. Payments are made by hand for now; automatic transfers will come later. A new account can be used after a 48-hour safety hold, and we email you whenever one is added.</p>
        </div>
        {accounts.length === 0 ? (
          <div className="px-4 pb-4"><Empty title="No payout account yet">Add the bank account or wallet you want to be paid into.</Empty></div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Method</th><th className="pr-4">Account title</th><th className="pr-4">Account</th><th className="pr-4">Status</th><th className="pr-4"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-border">
              {accounts.map((a) => { const s = payoutState(a, now); return (
                <tr key={a.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap">{a.method === "OTHER" ? a.otherName : PAYOUT_METHOD_LABEL[a.method]}{a.bankName && <span className="text-muted"> · {a.bankName}</span>}{a.isDefault && <> <Badge tone="primary">default</Badge></>}</td>
                  <td className="pr-4">{a.accountTitle}</td>
                  <td className="pr-4 whitespace-nowrap font-mono text-xs">{masked(a.accountLast4)}</td>
                  <td className="pr-4"><Badge tone={PAYOUT_TONE[s]}>{PAYOUT_STATE_LABEL[s]}</Badge>{s === "ON_HOLD" && <span className="block text-xs text-muted">usable from {when(a.usableFrom)}</span>}{s === "NEEDS_APPROVAL" && <span className="block text-xs text-muted">title differs from your verified name</span>}</td>
                  <td className="pr-4 py-2.5">
                    <div className="flex flex-wrap gap-2">
                      {!a.isDefault && <form action={defaultPayoutAction}><input type="hidden" name="id" value={a.id} /><SubmitButton className="btn-ghost text-xs" pendingText="…">Make default</SubmitButton></form>}
                      <form action={removePayoutAction}><input type="hidden" name="id" value={a.id} /><ConfirmButton className="btn-ghost text-xs" title="Remove this payout account?" message="Hifi will no longer pay into it. You can add it again later; it will then wait 48 hours again." confirmLabel="Remove">Remove</ConfirmButton></form>
                    </div>
                  </td>
                </tr>
              ); })}
            </tbody>
          </table></div>
        )}
        <details className="border-t border-border p-4" open={accounts.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">Add a payout account</summary>
          <form action={addPayoutAction} className="mt-3 space-y-3">
            <PayoutFields methods={PAYOUT_METHODS} accountLabel={ACCOUNT_FIELD} />
            {accounts.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="makeDefault" /> Make this my default</label>}
            <SubmitButton>Save payout account</SubmitButton>
          </form>
        </details>
      </section>
    </>
  );
}
