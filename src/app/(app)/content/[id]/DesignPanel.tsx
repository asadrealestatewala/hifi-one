// Design panel on a post: the words on the image, a layout, sizes and a photo, then our own code draws the branded PNGs
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DESIGN_LAYOUTS, DESIGN_SIZES } from "@/lib/design-render";
import { LIMITS, defaultSizes, designPhotos, getDesign } from "@/lib/design";
import { getKit } from "@/lib/brand-kit";
import { signDownload } from "@/lib/files";
import { SubmitButton, Notice } from "@/components/ui";
import { designAiPhoto, designWords, drawPostDesign } from "./design-actions";

const FLASH: Record<string, string> = {
  words: "Claude wrote the words below. Change anything you like, then press Make design.",
  photo: "AI photo added and picked below. Press Make design to use it.",
  drawn: "Design saved to the creative files below. Redraw as often as you like: drawing is free.",
};

export default async function DesignPanel({ user, item, claudeOn, imagesOn, flash }: {
  user: SessionUser;
  item: { id: string; title: string; postType: string; clientId: string | null };
  claudeOn: boolean; imagesOn: boolean;
  flash: { design?: string; designError?: string; photo?: string };
}) {
  const org = user.organizationId;
  const [design, photos, kit] = await Promise.all([getDesign(db, org, item.id), designPhotos(db, { organizationId: org, itemId: item.id, clientId: item.clientId }), getKit(db, org, item.clientId)]);
  const secret = process.env.SESSION_SECRET ?? "";
  const link = (id: string, dl = false) => `/api/files/${id}?t=${signDownload(id, user.id, secret)}${dl ? "&dl=1" : ""}`;
  const outputs = design?.outputFileIds.length ? await db.storedFile.findMany({ where: { id: { in: design.outputFileIds }, organizationId: org, deletedAt: null } }) : [];
  const all = [...photos.post.map((p) => ({ ...p, from: "This post" })), ...photos.library.map((p) => ({ id: p.id, name: p.name, from: p.folder }))];
  const chosen = flash.photo && all.some((p) => p.id === flash.photo) ? flash.photo : design ? design.photoFileId ?? "" : photos.post[0]?.id ?? "";
  const sizes = design?.sizes.length ? design.sizes : defaultSizes(item.postType);
  const kitLink = `/content/brand${item.clientId ? `?client=${item.clientId}` : ""}`;

  return (
    <section id="design" className="card space-y-4" aria-label="Design">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Design</h2>
        <Link href={kitLink} className="text-sm underline">{kit ? "Brand kit" : "Set up the brand kit first"}</Link>
      </div>
      {!kit && <p className="text-sm text-muted">No brand kit yet, so designs use standard colours and no logo. Add the logo, colours and contact details in the brand kit.</p>}
      {flash.designError && <Notice kind="error">{flash.designError}</Notice>}
      {flash.design && FLASH[flash.design] && <Notice kind="ok">{FLASH[flash.design]}</Notice>}

      {outputs.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {outputs.map((f) => (
            <figure key={f.id} className="space-y-1">
              <a href={link(f.id)} target="_blank" rel="noopener noreferrer"><img src={link(f.id)} alt={`Design ${f.filename}`} className="h-48 w-auto rounded-lg border border-border" /></a>
              <figcaption className="text-xs text-muted"><a className="underline" href={link(f.id, true)}>Download</a></figcaption>
            </figure>
          ))}
        </div>
      )}

      <form className="space-y-4">
        <input type="hidden" name="id" value={item.id} />
        {claudeOn && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
            <div className="min-w-56 flex-1"><label className="label" htmlFor="designNote">Note for AI <span className="font-normal text-muted">(optional)</span></label>
              <input id="designNote" name="designNote" maxLength={300} placeholder="e.g. focus on free delivery, use Roman Urdu" className="input" /></div>
            <SubmitButton formAction={designWords} className="btn-ghost" pendingText="Writing…">Write words with AI</SubmitButton>
            {imagesOn && <SubmitButton formAction={designAiPhoto} className="btn-ghost" pendingText="Making the photo…">New AI photo</SubmitButton>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label" htmlFor="headline">Headline <span className="font-normal text-muted">(8 words or fewer)</span></label>
            <input id="headline" name="headline" maxLength={LIMITS.headline} defaultValue={design?.headline ?? ""} className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="sub">Sub line <span className="font-normal text-muted">(optional)</span></label>
            <input id="sub" name="sub" maxLength={LIMITS.sub} defaultValue={design?.sub ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="cta">Button text <span className="font-normal text-muted">(optional)</span></label>
            <input id="cta" name="cta" maxLength={LIMITS.cta} defaultValue={design?.cta ?? ""} placeholder="Order now" className="input" /></div>
          <div><label className="label" htmlFor="label">Small tag <span className="font-normal text-muted">(optional)</span></label>
            <input id="label" name="label" maxLength={LIMITS.label} defaultValue={design?.label ?? ""} placeholder="Limited offer" className="input" /></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="layout">Layout</label>
            <select id="layout" name="layout" defaultValue={design?.layout ?? (all.length ? "OFFER" : "BOLD")} className="input">
              {Object.entries(DESIGN_LAYOUTS).map(([k, v]) => <option key={k} value={k}>{v.label}{v.photo ? " (photo)" : ""}: {v.hint}</option>)}
            </select></div>
          <fieldset><legend className="label">Sizes</legend>
            <div className="flex flex-wrap gap-2">{Object.entries(DESIGN_SIZES).map(([k, v]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                <input type="checkbox" name="sizes" value={k} defaultChecked={sizes.includes(k)} className="sr-only" />{v.label}</label>
            ))}</div></fieldset>
        </div>

        <fieldset><legend className="label">Photo</legend>
          <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto">
            <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border border-border text-center text-xs text-muted has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary">
              <input type="radio" name="photo" value="" defaultChecked={chosen === ""} className="sr-only" />No photo</label>
            {all.map((p) => (
              <label key={p.id} title={`${p.name} (${p.from})`} className="relative h-24 w-24 cursor-pointer overflow-hidden rounded-lg border border-border has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary">
                <input type="radio" name="photo" value={p.id} defaultChecked={chosen === p.id} className="sr-only" />
                <img src={link(p.id)} alt={p.name} className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 text-[10px] text-white">{p.from}</span>
              </label>
            ))}
          </div>
          {all.length === 0 && <p className="mt-1 text-xs text-muted">No photos yet. Upload one to the files below or the <Link className="underline" href={`${kitLink}${item.clientId ? "&" : "?"}tab=media`}>media library</Link>{imagesOn ? ", or make one with AI" : ""}.</p>}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton formAction={drawPostDesign} className="btn" pendingText="Drawing…">{outputs.length ? "Redraw design" : "Make design"}</SubmitButton>
          <p className="text-xs text-muted">Drawing is free. AI words cost a few cents and an AI photo about 5 cents, counted in the client&apos;s monthly AI limit.</p>
        </div>
      </form>
    </section>
  );
}
