import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { signDownload } from "@/lib/files";
import {
  DOCUMENTS, DOCUMENT_LABEL, ID_TYPES, ID_TYPE_LABEL, IDENTITY_STATE_LABEL, IDENTITY_TONE, PAYOUT_METHOD_LABEL, PAYOUT_STATE_LABEL, PAYOUT_TONE,
  documentsFor, identityState, masked, payoutReadiness, payoutState, revealIdNumber, revealPayoutAccount,
} from "@/lib/partner-identity";
import { certificateKindLabel, certificateStatus, durationLabel, parsePartnerId, partnerId } from "@/lib/partner-stack";
import { paging } from "@/lib/paging";
import { Badge, Chips, Empty, Notice, PageHeader, Pager, SearchBox, StatusBadge, ListToolbar } from "@/components/ui";
import { IdentityFields } from "@/components/PartnerIdentityFields";
import ScreenTabs from "@/components/shell/ScreenTabs";
import Drawer from "@/components/ui/Drawer";
import SubmitButton from "@/components/ui/SubmitButton";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { addPartnerAction, updateContactAction, approvePayoutAction, directAccessAction, issueCertificateAction, reviewIdentityAction, staffIdentityAction, staffRemovePayoutAction, updatePartnerAction } from "../actions";
import { DurationFields } from "../_components/Fields";
import { ResaleSection } from "../_components/ResaleSection";

export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; page?: string; open?: string; saved?: string; error?: string; new?: string; inquiry?: string; reveal?: string; f_name?: string; f_email?: string; f_phone?: string; f_city?: string; f_country?: string; f_territory?: string; f_typeKey?: string; f_ratePercent?: string; f_trainingReason?: string; f_sell?: string; f_optional?: string; f_lead?: string };
const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Approved partners and the terms each one earns on. Every term here is per person and can be changed at any time.
export default async function Partners({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const q = sp.q?.trim();
  const status = ["ACTIVE", "SUSPENDED"].includes(sp.status ?? "") ? sp.status : undefined;
  const byNumber = q ? parsePartnerId(q) : null;
  const where: Prisma.EarnerWhereInput = {
    organizationId: org, ...(status ? { status } : {}),
    ...(q ? { OR: [...(byNumber ? [{ partnerNumber: byNumber }] : []), { name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { referralCode: { contains: q, mode: "insensitive" } }, { territory: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const pg = paging(sp.page);
  const [rows, total, byStatus, open, types, solutions] = await Promise.all([
    db.earner.findMany({ where, include: { type: true, solutions: { include: { product: { select: { name: true } } } }, identity: { select: { status: true, recheckDueAt: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.earner.count({ where }),
    db.earner.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    sp.open ? db.earner.findFirst({ where: { id: sp.open, organizationId: org }, include: { type: true, solutions: { include: { product: true } }, certificates: { include: { product: { select: { name: true } } }, orderBy: [{ productId: "asc" }, { issuedAt: "desc" }] } } }) : null,
    db.earnerType.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" } }),
    db.saasProduct.findMany({ where: { organizationId: org, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const officer = user.permissions.has("partners.view_identity");
  const now = new Date();
  const [identity, docs, payouts, readiness, inquiry] = await Promise.all([
    open ? db.partnerIdentity.findUnique({ where: { earnerId: open.id } }) : null,
    open && officer ? documentsFor(db, org, open.id) : [],
    open ? db.partnerPayoutAccount.findMany({ where: { earnerId: open.id, organizationId: org }, orderBy: [{ removedAt: { sort: "desc", nulls: "first" } }, { createdAt: "asc" }], take: 20 }) : [],
    open ? payoutReadiness(db, { organizationId: org, earnerId: open.id, now }) : null,
    sp.new && sp.inquiry ? db.partnerInquiry.findFirst({ where: { id: sp.inquiry, organizationId: org } }) : null,
  ]);
  // Showing a full ID or account number is written to the audit log (without the number) at the moment it is shown
  let revealed: { key: string; value: string } | null = null;
  if (open && officer && sp.reveal) {
    const value = sp.reveal === "id" ? await revealIdNumber(db, org, open.id) : await revealPayoutAccount(db, { organizationId: org, earnerId: open.id, accountId: sp.reveal });
    if (value) {
      revealed = { key: sp.reveal, value };
      await audit(user, { action: sp.reveal === "id" ? "partner.identity.view_number" : "partner.payout.view_number", entity: sp.reveal === "id" ? "Earner" : "PartnerPayoutAccount", entityId: sp.reveal === "id" ? open.id : sp.reveal });
    }
  }
  const secret = process.env.SESSION_SECRET ?? "";
  const docLink = (id: string) => `/api/partner-identity/${id}?t=${signDownload(id, user.id, secret)}`;
  const idState = identityState(identity, now);
  const wantedType = types.find((t) => t.key === (sp.f_typeKey ?? (inquiry?.interestedType && inquiry.interestedType !== "NOT_SURE" ? inquiry.interestedType : "RESELLER"))) ?? types[0];
  const sellKept = new Set((sp.f_sell ?? "").split(",").filter(Boolean));
  const count = new Map(byStatus.map((s) => [s.status, s._count]));
  const all = byStatus.reduce((n, s) => n + s._count, 0);
  const current = { q, status };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/partner-stack/partners${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="partner-stack" current="/partner-stack/partners" />} title="Partner Stack" subtitle="Approved partners and the terms each one earns on." actions={<Link className="btn" href="/partner-stack/partners?new=1">Add partner</Link>} />
      <ListToolbar>
        <SearchBox q={q} placeholder="Search Partner ID, name, email, territory or referral code" hidden={{ ...current, q: undefined }} />
        <Chips current={status ?? "all"} items={[{ key: "all", label: "All", count: all, href: href({ status: undefined, page: undefined }) }, { key: "ACTIVE", label: "Active", count: count.get("ACTIVE") ?? 0, href: href({ status: "ACTIVE", page: undefined }) }, { key: "SUSPENDED", label: "Suspended", count: count.get("SUSPENDED") ?? 0, href: href({ status: "SUSPENDED", page: undefined }) }]} />
      </ListToolbar>
      {rows.length === 0 ? (
        <Empty title={all === 0 ? "No partners yet" : "No partners match these filters"}>{all === 0 ? <>Approve an application to create the first partner. <Link className="underline" href="/partner-stack">Open applications</Link></> : <Link className="underline" href="/partner-stack/partners">Clear filters</Link>}</Empty>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Partner ID</th><th className="pr-4">Partner</th><th className="pr-4">Type</th><th className="pr-4">Commission</th><th className="pr-4">Solutions</th><th className="pr-4">Identity</th><th className="pr-4">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs">{partnerId(e.partnerNumber)}</td>
                  <td className="pr-4 py-2.5"><Link className="font-medium hover:underline" href={href({ open: e.id })}>{e.name}</Link><br /><span className="text-muted">{e.email}</span></td>
                  <td className="pr-4">{e.type.name}</td>
                  <td className="pr-4 whitespace-nowrap">{Number(e.ratePercent)}% · {durationLabel(e.durationMonths).split(" (")[0]}</td>
                  <td className="pr-4">{e.solutions.map((s) => s.product.name).join(", ")}</td>
                  <td className="pr-4 whitespace-nowrap">{(() => { const st = identityState(e.identity, now); return <Badge tone={IDENTITY_TONE[st]}>{IDENTITY_STATE_LABEL[st]}</Badge>; })()}</td>
                  <td className="pr-4"><StatusBadge status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={total} href={(n) => href({ page: String(n) })} />
        </div>
      )}
      {open && (
        <Drawer title={`${open.name} · ${partnerId(open.partnerNumber)}`} closeTo={href({})}>
          <div className="h-full space-y-5 overflow-y-auto p-5">
            {sp.saved && <Notice kind="ok">{sp.saved === "1" ? "Saved." : sp.saved}</Notice>}
            {sp.error && <Notice kind="error">{sp.error}</Notice>}
            <p className="text-sm text-muted">{open.email}{open.phone && ` · ${open.phone}`}{open.city && ` · ${open.city}, ${open.country}`} · referral code <code>{open.referralCode}</code></p>
            <details className="card">
              <summary className="cursor-pointer font-semibold">Edit contact details</summary>
              <form action={updateContactAction} className="mt-3 space-y-3">
                <input type="hidden" name="id" value={open.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className="label" htmlFor="cd-name">Name</label><input id="cd-name" name="name" required maxLength={120} defaultValue={open.name} className="input" /></div>
                  <div><label className="label" htmlFor="cd-email">Email (they sign in with it)</label><input id="cd-email" name="email" type="email" required maxLength={200} defaultValue={open.email} className="input" /></div>
                  <div><label className="label" htmlFor="cd-phone">Phone or WhatsApp</label><input id="cd-phone" name="phone" required maxLength={40} defaultValue={open.phone ?? ""} className="input" /></div>
                  <div><label className="label" htmlFor="cd-city">City</label><input id="cd-city" name="city" maxLength={80} defaultValue={open.city ?? ""} className="input" /></div>
                  <div><label className="label" htmlFor="cd-country">Country</label><input id="cd-country" name="country" maxLength={80} defaultValue={open.country ?? ""} className="input" /></div>
                </div>
                <p className="text-xs text-muted">A new email becomes their sign-in email straight away; their password stays the same, and both the old and new addresses are told. Once the identity check is verified, the name follows it. To reset the password, use Create reset link in Administration → Users &amp; roles.</p>
                <SubmitButton>Save contact details</SubmitButton>
              </form>
            </details>
            <form action={updatePartnerAction} className="card space-y-3">
              <h3 className="font-semibold">Terms</h3>
              <input type="hidden" name="id" value={open.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="pt-type">Partner type</label><select id="pt-type" name="typeKey" defaultValue={open.type.key} className="input">{types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></div>
                <div><label className="label" htmlFor="pt-rate">Commission %</label><input id="pt-rate" name="ratePercent" required inputMode="decimal" defaultValue={String(Number(open.ratePercent))} className="input" /></div>
              </div>
              <DurationFields idPrefix="pt" months={open.durationMonths} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="pt-terr">Territory</label><input id="pt-terr" name="territory" maxLength={200} defaultValue={open.territory ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="pt-exp">Certificate validity (days)</label><input id="pt-exp" name="certExpiryDays" type="number" min={1} defaultValue={open.certExpiryDays ?? ""} className="input" placeholder="Default" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="leadSharing" defaultChecked={open.leadSharing} /> Share Hifi leads in their territory</label>
              <div><label className="label" htmlFor="pt-status">Status</label><select id="pt-status" name="status" defaultValue={open.status} className="input"><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended (cannot sign in)</option></select></div>
              <fieldset className="space-y-1"><legend className="label">Solutions they may sell</legend>
                <div className="grid gap-1 sm:grid-cols-2">{solutions.map((s) => <label key={s.code} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`sell_${s.code}`} defaultChecked={open.solutions.some((x) => x.productId === s.id)} /> {s.name}</label>)}</div></fieldset>
              <SubmitButton>Save terms</SubmitButton>
            </form>
            <section className="card space-y-3">
              <h3 className="font-semibold">Certificates</h3>
              {open.certificates.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {open.certificates.map((c) => { const st = certificateStatus(c, now); return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{c.product.name} · {certificateKindLabel(c.kind)} · <code>{c.publicId}</code></span><span className="text-muted">{st === "REVOKED" ? "revoked" : !c.expiresAt ? `completed ${when(c.issuedAt)}` : `${st === "EXPIRED" ? "expired" : "valid until"} ${when(c.expiresAt)}`}</span></li>
                  ); })}
                </ul>
              )}
              {open.status === "ACTIVE" && open.solutions.length > 0 && (
                <form action={issueCertificateAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={open.id} />
                  <div><label className="label" htmlFor="ic-kind">Certificate</label><select id="ic-kind" name="kind" className="input"><option value="TRAINING">Training certificate (training done)</option><option value="AUTHORISATION">Certificate of authorisation</option></select></div>
                  <div><label className="label" htmlFor="ic-sol">For</label><select id="ic-sol" name="solutionCode" className="input">{open.solutions.map((s) => <option key={s.productId} value={s.product.code}>{s.product.name}</option>)}</select></div>
                  <SubmitButton>Issue and email</SubmitButton>
                </form>
              )}
              {open.status === "ACTIVE" && open.solutions.length > 0 && (
                <p className="text-xs text-muted">Training comes first. The Partner Academy issues both certificates automatically: the training certificate when the partner finishes a Solution&rsquo;s course, the certificate of authorisation when they pass its final test. {open.type.academyRequired && !open.academyDirectAccess ? `As a ${open.type.name}, this partner earns the certificate of authorisation through the final test; make training optional below to issue it by hand.` : "You can issue both by hand here."}</p>
              )}
            </section>
            {open.type.academyRequired && (
              <section className="card space-y-2">
                <h3 className="font-semibold">Training optional</h3>
                {open.academyDirectAccess ? (
                  <>
                    <p className="text-sm">Since {open.directAccessAt ? when(open.directAccessAt) : ""}: {open.directAccessReason}. This partner can sell without finishing the Academy; you can issue the certificate of authorisation by hand. All courses and videos stay open to them free of charge.</p>
                    <form action={directAccessAction}><input type="hidden" name="id" value={open.id} /><input type="hidden" name="on" value="0" /><ConfirmButton title="Make training required again?" message="The partner will earn the certificate of authorisation through the Academy final test again. Certificates already issued stay valid." confirmLabel="Make required">Make training required</ConfirmButton></form>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted">For a partner who can sell without finishing the Academy, for example a reseller with their own schools or one bringing an enterprise client. The courses and videos stay open to them free of charge. You give the reason; it is recorded in the audit log.</p>
                    <form action={directAccessAction}><input type="hidden" name="id" value={open.id} /><input type="hidden" name="on" value="1" /><ConfirmButton reason className="btn-ghost" title="Make training optional?" message={<>{open.name} can sell without finishing the Partner Academy, and you can issue their certificate of authorisation by hand.</>} confirmLabel="Make optional">Make training optional</ConfirmButton></form>
                  </>
                )}
              </section>
            )}
            <ResaleSection organizationId={org} earnerId={open.id} solutions={open.solutions} />
            <section className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Identity check</h3><Badge tone={IDENTITY_TONE[idState]}>{IDENTITY_STATE_LABEL[idState]}</Badge></div>
              {!identity ? (
                <p className="text-sm text-muted">Not sent yet. The partner fills it in under My details in their portal{officer ? ", or you can enter what they sent you below" : ""}. It is needed before payouts and resale billing, not before training.</p>
              ) : !officer ? (
                <p className="text-sm text-muted">{identity.legalName} · {ID_TYPE_LABEL[identity.idType]}. Only people allowed to see identity documents can open the details.</p>
              ) : (
                <>
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-muted">Legal name</dt><dd>{identity.legalName}</dd>
                    <dt className="text-muted">{ID_TYPE_LABEL[identity.idType]}</dt>
                    <dd>{revealed?.key === "id" ? <span className="font-mono">{revealed.value}</span> : <>{masked(identity.idLast4)} <Link className="text-xs underline" href={href({ open: open.id, reveal: "id" })}>Show full number (logged)</Link></>}</dd>
                    <dt className="text-muted">Address</dt><dd>{identity.address}</dd>
                    {identity.businessName && <><dt className="text-muted">Business</dt><dd>{identity.businessName}{identity.ntn && ` · NTN ${identity.ntn}`}{identity.secpNumber && ` · SECP ${identity.secpNumber}`}{identity.ntn && (identity.activeTaxpayer ? " · on Active Taxpayer List" : " · not on Active Taxpayer List")}</dd></>}
                    <dt className="text-muted">Pictures</dt>
                    <dd>{docs.length === 0 ? <span className="text-muted">None</span> : <span className="flex flex-wrap gap-x-3">{docs.map((f) => <a key={f.id} className="underline" href={docLink(f.id)} target="_blank" rel="noopener">{DOCUMENT_LABEL[f.category ?? ""] ?? f.filename}</a>)}</span>}<span className="block text-xs text-muted">Opening a picture is logged.</span></dd>
                    <dt className="text-muted">Sent</dt><dd>{when(identity.submittedAt)}</dd>
                    {identity.reviewedAt && <><dt className="text-muted">{identity.status === "REJECTED" ? "Sent back" : "Verified"}</dt><dd>{when(identity.reviewedAt)}{identity.rejectReason && `: ${identity.rejectReason}`}</dd></>}
                    {identity.recheckDueAt && identity.status === "VERIFIED" && <><dt className="text-muted">Yearly re-check</dt><dd>{when(identity.recheckDueAt)}</dd></>}
                  </dl>
                  {identity.status === "SUBMITTED" && (
                    <div className="flex flex-wrap gap-2">
                      <form action={reviewIdentityAction}><input type="hidden" name="id" value={open.id} /><input type="hidden" name="decision" value="VERIFY" /><ConfirmButton className="btn" title="Verify this identity?" message="Confirm the name, number and pictures match, and the pictures are clear and not expired. The partner is emailed." confirmLabel="Verify">Verify</ConfirmButton></form>
                      <form action={reviewIdentityAction}><input type="hidden" name="id" value={open.id} /><input type="hidden" name="decision" value="REJECT" /><ConfirmButton reason title="Send back to the partner?" message="Say what they need to correct. They see your reason in their portal and by email." confirmLabel="Send back">Send back</ConfirmButton></form>
                    </div>
                  )}
                </>
              )}
              {officer && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">{identity ? "Correct the details for the partner" : "Enter details the partner sent you"}</summary>
                  <form action={staffIdentityAction} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={open.id} />
                    <IdentityFields idTypes={ID_TYPES} documents={DOCUMENTS} last4={identity?.idLast4 ?? null}
                      saved={docs.map((f) => ({ key: f.category ?? "", name: f.filename, href: docLink(f.id) }))}
                      initial={{ legalName: identity?.legalName ?? open.name, idType: identity?.idType ?? "CNIC", businessName: identity?.businessName ?? "", ntn: identity?.ntn ?? "", secpNumber: identity?.secpNumber ?? "", activeTaxpayer: identity?.activeTaxpayer ?? false, address: identity?.address ?? "" }} />
                    <p className="text-xs text-muted">Saved details wait for review. Ask a colleague to verify them, so the same person does not enter and verify.</p>
                    <SubmitButton>Save for review</SubmitButton>
                  </form>
                </details>
              )}
            </section>
            <section className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Payout accounts</h3>{readiness && <Badge tone={readiness.ready ? "success" : "warning"}>{readiness.ready ? "Ready for payouts" : "Not ready for payouts"}</Badge>}</div>
              {readiness && !readiness.ready && <ul className="list-disc pl-5 text-sm text-muted">{readiness.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              {payouts.length === 0 ? <p className="text-sm text-muted">None yet. The partner adds their own under My details: bank account, Easypaisa, JazzCash, SadaPay, NayaPay, PayPal, Stripe or another service. Hifi pays by hand; no transfer service is connected.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {payouts.map((a) => { const st = payoutState(a, now); return (
                    <li key={a.id} className="space-y-1 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{a.method === "OTHER" ? a.otherName : PAYOUT_METHOD_LABEL[a.method]}{a.bankName && ` · ${a.bankName}`} · {a.accountTitle} · {revealed?.key === a.id ? <span className="font-mono">{revealed.value}</span> : <span className="font-mono">{masked(a.accountLast4)}</span>}{a.isDefault && <> <Badge tone="primary">default</Badge></>}</span>
                        <Badge tone={PAYOUT_TONE[st]}>{PAYOUT_STATE_LABEL[st]}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                        <span>Added {when(a.createdAt)}{st === "ON_HOLD" && `, usable from ${a.usableFrom.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" })}`}{a.removedAt && `, removed ${when(a.removedAt)}`}</span>
                        {officer && !a.removedAt && revealed?.key !== a.id && <Link className="underline" href={href({ open: open.id, reveal: a.id })}>Show full account (logged)</Link>}
                        {officer && st === "NEEDS_APPROVAL" && <form action={approvePayoutAction}><input type="hidden" name="id" value={open.id} /><input type="hidden" name="accountId" value={a.id} /><ConfirmButton reason className="btn-ghost text-xs" title="Approve this account?" message={<>The title &ldquo;{a.accountTitle}&rdquo; does not match the partner&rsquo;s verified name. Approve only after confirming the account belongs to them (for example a business account in their name).</>} confirmLabel="Approve">Approve title</ConfirmButton></form>}
                        {!a.removedAt && <form action={staffRemovePayoutAction}><input type="hidden" name="id" value={open.id} /><input type="hidden" name="accountId" value={a.id} /><ConfirmButton reason className="btn-ghost text-xs" title="Remove this payout account?" message="Hifi will stop paying into it. The partner can add an account again." confirmLabel="Remove">Remove</ConfirmButton></form>}
                      </div>
                    </li>
                  ); })}
                </ul>
              )}
            </section>
          </div>
        </Drawer>
      )}
      {sp.new && (
        <Drawer title={inquiry ? `Add ${inquiry.name} as a partner` : "Add partner"} closeTo="/partner-stack/partners">
          <div className="h-full space-y-5 overflow-y-auto p-5">
            {sp.error && <Notice kind="error">{sp.error}</Notice>}
            <p className="text-sm text-muted">For a partner you agreed terms with directly. They get the same welcome email as an approved applicant, with a link to set their own password.</p>
            <form action={addPartnerAction} className="space-y-3">
              {inquiry && <input type="hidden" name="inquiryId" value={inquiry.id} />}
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="np-name">Name</label><input id="np-name" name="name" required maxLength={120} defaultValue={sp.f_name ?? inquiry?.name ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="np-email">Email (they sign in with it)</label><input id="np-email" name="email" type="email" required maxLength={200} defaultValue={sp.f_email ?? inquiry?.email ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="np-phone">Phone or WhatsApp</label><input id="np-phone" name="phone" required maxLength={40} defaultValue={sp.f_phone ?? inquiry?.phone ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="np-city">City</label><input id="np-city" name="city" maxLength={80} defaultValue={sp.f_city ?? inquiry?.city ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="np-country">Country</label><input id="np-country" name="country" maxLength={80} defaultValue={sp.f_country ?? inquiry?.country ?? "Pakistan"} className="input" /></div>
                <div><label className="label" htmlFor="np-terr">Territory</label><input id="np-terr" name="territory" maxLength={200} defaultValue={sp.f_territory ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="np-type">Partner type</label><select id="np-type" name="typeKey" defaultValue={wantedType?.key} className="input">{types.filter((t) => t.active && t.key !== "SALES_AGENT").map((t) => <option key={t.key} value={t.key}>{t.name} (default {Number(t.defaultRate)}%)</option>)}</select></div>
                <div><label className="label" htmlFor="np-rate">Commission %</label><input id="np-rate" name="ratePercent" required inputMode="decimal" defaultValue={sp.f_ratePercent ?? (wantedType ? String(Number(wantedType.defaultRate)) : "")} className="input" /></div>
              </div>
              <DurationFields idPrefix="np" months={wantedType?.defaultDurationMonths} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="leadSharing" defaultChecked={sp.f_lead === "1"} /> Share Hifi leads in their territory</label>
              <fieldset className="space-y-1"><legend className="label">Solutions they may sell</legend>
                <div className="grid gap-1 sm:grid-cols-2">{solutions.map((s) => <label key={s.code} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`sell_${s.code}`} defaultChecked={sellKept.has(s.code)} /> {s.name}</label>)}</div></fieldset>
              <fieldset className="card space-y-2">
                <legend className="sr-only">Training</legend>
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="trainingOptional" defaultChecked={sp.f_optional === "1"} /> Training optional</label>
                <p className="text-xs text-muted">They can sell without finishing the Partner Academy, and you can issue the certificate of authorisation by hand. Courses and videos stay open to them free of charge.</p>
                <div><label className="label" htmlFor="np-reason">Reason (needed if training is optional; kept in the audit log)</label><input id="np-reason" name="trainingReason" maxLength={300} defaultValue={sp.f_trainingReason ?? ""} className="input" placeholder="For example: runs a group of schools and will sell Campusly to them" /></div>
              </fieldset>
              <SubmitButton pendingText="Adding…">Add partner and email them</SubmitButton>
            </form>
          </div>
        </Drawer>
      )}
    </div>
  );
}
