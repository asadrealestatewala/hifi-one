import { redirect } from "next/navigation";
import { audit, requireClientUser, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { signDownload } from "@/lib/files";
import { BrandError, COLOR_LABEL, LOGO_SLOTS, LOGO_SLOT_LABEL, addMedia, cleanColors, getKit, listMedia, type LogoSlot } from "@/lib/brand-kit";
import { defaultStorage } from "@/lib/storage";
import { Notice, PageHeader, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

const PORTAL_FOLDERS = ["Logos", "Products", "Photos", "Team", "Other"];

// The client adds logos and photos for their posts. Colours and fonts are kept by the team, so the client sees them but does not edit them.
async function upload(formData: FormData) {
  "use server";
  const user = await requireClientUser();
  const files = formData.getAll("file").filter((x): x is File => x instanceof File && x.size > 0);
  const folder = String(formData.get("folder") ?? "");
  let n = 0;
  try {
    if (!files.length) throw new BrandError("Choose a file to upload.");
    for (const f of files.slice(0, 10)) {
      const { item } = await addMedia(db, defaultStorage(), { actor: toFileActor(user), clientId: user.clientId, name: f.name, bytes: Buffer.from(await f.arrayBuffer()), folder: PORTAL_FOLDERS.includes(folder) ? folder : "Other", title: String(formData.get("title") ?? "") });
      await audit(user, { action: "brand.client_upload", entity: "MediaItem", entityId: item.id });
      n++;
    }
  } catch (e) {
    if (e instanceof BrandError) redirect(`/portal/brand?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/portal/brand?ok=${encodeURIComponent(`${n} file${n === 1 ? "" : "s"} added. Your team has been told.`)}`);
}

export default async function PortalBrand({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireClientUser();
  const sp = await searchParams;
  const [kit, media] = await Promise.all([getKit(db, user.organizationId, user.clientId), listMedia(db, { organizationId: user.organizationId, clientId: user.clientId, take: 60 })]);
  const ids = media.map((m) => m.fileId).concat([kit?.logoFileId, kit?.logoLightFileId, kit?.iconFileId].filter((x): x is string => Boolean(x)));
  const files = await db.storedFile.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, filename: true } });
  const secret = process.env.SESSION_SECRET ?? "";
  const src = (id: string | null | undefined) => (id && files.some((f) => f.id === id) ? `/api/files/${id}?t=${signDownload(id, user.id, secret, 3600)}` : null);
  const colors = cleanColors(kit?.colors ?? []);
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Brand & media" subtitle="Your logos, colours and photos that our team uses for your posts. Send us new logos and product photos here instead of by message." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <section className="card space-y-3">
        <h2 className="font-semibold">Your brand</h2>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(LOGO_SLOTS) as LogoSlot[]).map((slot) => { const url = src(kit?.[LOGO_SLOTS[slot]]); return url ? (
            <figure key={slot} className="space-y-1 text-center"><div className={`flex h-20 w-32 items-center justify-center rounded-lg p-2 ${slot === "LOGO_LIGHT" ? "bg-gray-800" : "bg-hover"}`}><img src={url} alt={LOGO_SLOT_LABEL[slot]} className="max-h-full max-w-full object-contain" /></div><figcaption className="text-xs text-muted">{LOGO_SLOT_LABEL[slot]}</figcaption></figure>
          ) : null; })}
          {!kit?.logoFileId && <p className="text-sm text-muted">No logo yet. Upload it below in the Logos folder.</p>}
        </div>
        {colors.length > 0 && <div className="flex flex-wrap gap-3">{colors.map((c) => <span key={c.role} className="flex items-center gap-1.5 text-sm"><span className="h-6 w-6 rounded-full border border-border" style={{ background: c.hex }} />{COLOR_LABEL[c.role]} {c.hex}</span>)}</div>}
        {(kit?.headingFont || kit?.bodyFont) && <p className="text-sm text-muted">Fonts: {[kit?.headingFont, kit?.bodyFont].filter(Boolean).join(", ")}</p>}
        <p className="text-xs text-muted">To change colours or fonts, message your project manager.</p>
      </section>
      <form action={upload} className="card grid gap-3 sm:grid-cols-3 sm:items-end">
        <div className="sm:col-span-2"><label className="label" htmlFor="pb-file">Logos or photos <span className="font-normal text-muted">(up to 10 images)</span></label><input id="pb-file" type="file" name="file" multiple required accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="block w-full text-sm" /></div>
        <div><label className="label" htmlFor="pb-folder">What are they?</label><select id="pb-folder" name="folder" className="input">{PORTAL_FOLDERS.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
        <div className="sm:col-span-3"><label className="label" htmlFor="pb-title">Note <span className="font-normal text-muted">(optional)</span></label><input id="pb-title" name="title" maxLength={120} placeholder="e.g. New winter collection" className="input" /></div>
        <div><SubmitButton className="btn" pendingText="Uploading…">Send to the team</SubmitButton></div>
      </form>
      {media.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Your library</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {media.map((m) => { const url = src(m.fileId); return (
              <li key={m.id} className="space-y-1"><div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-hover">{url && <img src={url} alt={m.title ?? "Library image"} loading="lazy" className="max-h-full max-w-full object-contain" />}</div><p className="truncate text-[11px] text-muted">{m.folder}{m.title ? ` · ${m.title}` : ""}</p></li>
            ); })}
          </ul>
        </section>
      )}
    </div>
  );
}
