import Image from "next/image";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { checkSharePassword, isUnlocked, kindOf, makeUnlock, recordShareView, resolveShare, shareContent, unlockCookieName } from "@/lib/project-assets";
import { limiter } from "@/lib/rate-limit";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project files", robots: { index: false, follow: false } };

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function unlock(formData: FormData): Promise<void> {
  "use server";
  const token = String(formData.get("token") ?? "");
  const ip = ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const to = (e: string) => redirect(`/a/${token}?error=${encodeURIComponent(e)}`);
  if (!limiter("asset-share-password", 10, 600_000).take(`${ip}:${token}`)) return to("Too many attempts. Please wait a few minutes.");
  const share = await resolveShare(db, token);
  if (!share || !share.passwordHash) return to("This link is not valid any more.");
  if (!checkSharePassword(String(formData.get("password") ?? ""), share.passwordHash)) return to("That password is not right.");
  (await cookies()).set(unlockCookieName(share.id), makeUnlock(share, process.env.SESSION_SECRET ?? ""), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: `/a/${token}`, maxAge: 12 * 3600,
  });
  redirect(`/a/${token}`);
}

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-4 py-8 sm:p-8">
    <div className="flex items-center gap-3"><Image src="/logo.png" alt="" width={36} height={36} className="rounded-lg" /><span className="font-semibold">Hifi Marketing and Technologies</span></div>
    {children}
  </main>
);

// A public, read-only view of a project's asset library for people without an account (a brand manager, a designer). The secret in the
// address is the key; the link can expire, carry a password and be switched off by the project manager.
export default async function SharedAssets({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const share = await resolveShare(db, token);
  if (!share) return <Shell><h1 className="text-xl font-semibold">This link is not available</h1><p className="text-sm text-muted">It may have expired or been switched off. Ask the sender for a new link.</p></Shell>;
  if (!isUnlocked(share, (await cookies()).get(unlockCookieName(share.id))?.value, process.env.SESSION_SECRET ?? "")) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{share.project.name}</h1>
        <p className="text-sm text-muted">Enter the password you were given to see these files.</p>
        {error && <Notice kind="error">{error}</Notice>}
        <form action={unlock} className="card flex max-w-sm flex-wrap items-end gap-2">
          <input type="hidden" name="token" value={token} />
          <div className="grow"><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" required autoFocus autoComplete="off" className="input" /></div>
          <button className="btn">Open files</button>
        </form>
      </Shell>
    );
  }
  await recordShareView(db, share.id);
  const assets = await shareContent(db, share);
  const folders = [...new Set(assets.map((a) => a.folder))];
  const base = `/a/${token}/f`;
  return (
    <Shell>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{share.project.name}</h1>
        <p className="text-sm text-muted">{share.folder ? `${share.folder} · ` : ""}{assets.length} {assets.length === 1 ? "file" : "files"} · view and download only{share.expiresAt && ` · link works until ${share.expiresAt.toISOString().slice(0, 10)}`}</p>
      </header>
      {assets.length === 0 && <p className="text-sm text-muted">Nothing has been added yet.</p>}
      {folders.map((folder) => (
        <section key={folder} className="space-y-3">
          <h2 className="font-semibold">{folder}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assets.filter((a) => a.folder === folder).map((a) => {
              const c = a.current;
              const kind = kindOf(c.contentType);
              return (
                <li key={a.id} className="card !p-3 space-y-2">
                  <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-hover">
                    {kind === "image" && <img src={`${base}/${c.id}`} alt={a.name} loading="lazy" className="max-h-full max-w-full object-contain" />}
                    {kind === "video" && <video src={`${base}/${c.id}`} controls preload="metadata" className="max-h-full max-w-full" />}
                    {(kind === "pdf" || kind === "file") && <span className="text-sm font-medium text-muted">{kind === "pdf" ? "PDF" : c.filename.split(".").pop()?.toUpperCase()}</span>}
                  </div>
                  <div>
                    <p className="font-medium break-words">{a.name}</p>
                    <p className="text-xs text-muted">{c.filename} · {kb(c.size)}{a.versions.length > 1 && ` · version ${c.version}`}</p>
                    {a.tags.length > 0 && <p className="text-xs text-muted">{a.tags.map((t) => `#${t}`).join(" ")}</p>}
                    {a.description && <p className="text-xs text-muted">{a.description}</p>}
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {(kind === "pdf" || kind === "image") && <a className="text-primary hover:underline" href={`${base}/${c.id}`} target="_blank" rel="noopener noreferrer">Open</a>}
                    <a className="text-primary hover:underline" href={`${base}/${c.id}?dl=1`}>Download</a>
                  </div>
                  {a.versions.length > 1 && (
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer">Earlier versions</summary>
                      <ul className="mt-1 space-y-0.5">{a.versions.slice(0, -1).reverse().map((v) => <li key={v.id}>v{v.version} · {v.createdAt.toISOString().slice(0, 10)} · <a className="text-primary hover:underline" href={`${base}/${v.id}?dl=1`}>Download</a></li>)}</ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Shell>
  );
}
