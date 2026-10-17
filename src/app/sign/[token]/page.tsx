import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AgreementError, declineAgreement, loadForSigning, signAgreement } from "@/lib/agreements";
import { db } from "@/lib/db";
import { limiter } from "@/lib/rate-limit";
import { Notice } from "@/components/ui";
import SignForm from "./SignForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign agreement", robots: { index: false, follow: false } };

async function clientIp() {
  return ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
}

async function sign(formData: FormData): Promise<void> {
  "use server";
  const token = String(formData.get("token") ?? "");
  const ip = await clientIp();
  if (!limiter("agreement-sign", 20, 600_000).take(ip)) redirect(`/sign/${token}?error=${encodeURIComponent("Too many attempts. Please wait a few minutes.")}`);
  try {
    await signAgreement(db, { token, name: String(formData.get("name") ?? ""), agree: formData.get("agree") === "1", signatureImage: String(formData.get("signatureImage") ?? ""), ip: ip === "local" ? null : ip, userAgent: (await headers()).get("user-agent") });
  } catch (e) {
    if (e instanceof AgreementError) redirect(`/sign/${token}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/sign/${token}?done=signed`);
}

async function decline(formData: FormData): Promise<void> {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!limiter("agreement-sign", 20, 600_000).take(await clientIp())) redirect(`/sign/${token}?error=${encodeURIComponent("Too many attempts. Please wait a few minutes.")}`);
  try {
    await declineAgreement(db, { token, reason: String(formData.get("reason") ?? "") });
  } catch (e) {
    if (e instanceof AgreementError) redirect(`/sign/${token}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/sign/${token}?done=declined`);
}

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto min-h-screen max-w-2xl space-y-5 p-5 sm:p-8">
    <div className="flex items-center gap-3"><Image src="/logo.png" alt="" width={36} height={36} className="rounded-lg" /><span className="font-semibold">Hifi Marketing and Technologies</span></div>
    {children}
  </main>
);

// Opened from a one-time link; no account. The secret in the address is the only thing that identifies the signer.
export default async function SignPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  if (sp.done === "signed") return <Shell><h1 className="text-2xl font-semibold tracking-tight">Thank you, the agreement is signed</h1><p className="text-sm text-muted">We have recorded your signature and told the team. You can close this page.</p></Shell>;
  if (sp.done === "declined") return <Shell><h1 className="text-2xl font-semibold tracking-tight">You declined this agreement</h1><p className="text-sm text-muted">We have told the team and recorded your reason. You can close this page.</p></Shell>;
  const a = await loadForSigning(db, token);
  if (!a) return <Shell><h1 className="text-xl font-semibold">This signing link is not valid any more</h1><p className="text-sm text-muted">It may have been used, withdrawn or expired. Ask the sender for a new link.</p></Shell>;
  return (
    <Shell>
      <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{a.number} · {a.company}</p><h1 className="text-2xl font-semibold tracking-tight">{a.title}</h1></div>
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-surface p-4 font-sans text-sm" tabIndex={0} aria-label="Agreement text">{a.body}</pre>
      <SignForm token={token} defaultName={a.signerName ?? ""} signAction={sign} declineAction={decline} />
      <p className="text-xs text-muted">This link works once and is valid until {a.expiresAt.toISOString().slice(0, 10)}. Your name, the time, your network address and browser are recorded with your signature.</p>
    </Shell>
  );
}
