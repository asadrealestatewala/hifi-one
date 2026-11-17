// Design panel on a post: the words on the image, a layout, sizes and a photo, then our own code draws the branded PNGs
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DESIGN_LAYOUTS, DESIGN_SIZES } from "@/lib/design-render";
import { LIMITS, defaultKind, defaultSizes, designPhotos, getDesign, recentDesigns, slidesOf } from "@/lib/design";
import { getKit } from "@/lib/brand-kit";
import { signDownload } from "@/lib/files";
import { SubmitButton, Notice } from "@/components/ui";
import { designAiPhoto, designWords, drawPostDesign } from "./design-actions";

const FLASH: Record<string, string> = {
  words: "Claude wrote the words below. Change anything you like, then press Make design.",
  photo: "AI photo added and picked below. Press Make design to use it.",
  drawn: "Design saved to the creative files below. Redraw as often as you like: drawing is free.",
  style: "Layout and sizes copied from the recent design. Press Make design to draw it.",
};

export default async function DesignPanel({ user, item, claudeOn, imagesOn, flash }: {
  user: SessionUser;
  item: { id: string; title: string; postType: string; clientId: string | null };
  claudeOn: boolean; imagesOn: boolean;
  flash: { design?: string; designError?: string; photo?: string; style?: string };
}) {
  const org = user.organizationId;
  const [design, photos, kit] = await Promise.all([getDesign(db, org, item.id), designPhotos(db, { organizationId: org, itemId: item.id, clientId: item.clientId }), getKit(db, org, item.clientId)]);
  const secret = process.env.SESSION_SECRET ?? "";
  const link = (id: string, dl = false) => `/api/files/${id}?t=${signDownload(id, user.id, secret)}${dl ? "&dl=1" : ""}`;
  const outputs = (design?.outputFileIds.length ? await db.storedFile.findMany({ where: { id: { in: design.outputFileIds }, organizationId: org, deletedAt: null } }) : [])
    .sort((a, b) => design!.outputFileIds.indexOf(a.id) - design!.outputFileIds.indexOf(b.id));
  const recent = await recentDesigns(db, { organizationId: org, clientId: item.clientId, exceptItemId: item.id });
  const style = flash.style ? recent.find((r) => r.id === flash.style) : undefined;
  const kind = style?.kind ?? design?.kind ?? defaultKind(item.postType);
  const slides = slidesOf(design?.slides);
  const all = [...photos.post.map((p) => ({ ...p, from: "This post" })), ...photos.library.map((p) => ({ id: p.id, name: p.name, from: p.folder }))];
  const chosen = flash.photo && all.some((p) => p.id === flash.photo) ? flash.photo : design ? design.photoFileId ?? "" : photos.post[0]?.id ?? "";
  const sizes = style?.sizes ?? (design?.sizes.length ? design.sizes : kind === "CAROUSEL" ? ["SQUARE"] : defaultSizes(item.postType));
  const layoutValue = style?.layout ?? design?.layout ?? (all.length ? "OFFER" : "BOLD");
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
      {style && <Notice kind="ok">{FLASH.style}</Notice>}

      {outputs.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {outputs.map((f) => (
            <figure key={f.id} className="space-y-1">
              <a href={link(f.id)} target="_blank" rel="noopener noreferrer"><img src={link(f.id)} alt={`Design ${f.filename}`} className={`${design?.kind === "CAROUSEL" ? "h-36" : "h-48"} w-auto rounded-lg border border-border`} /></a>
              <figcaption className="text-xs text-muted">{design?.kind === "CAROUSEL" && <span>Slide {design.outputFileIds.indexOf(f.id) + 1} · </span>}<a className="underline" href={link(f.id, true)}>Download</a></figcaption>
            </figure>
          ))}
        </div>
      )}

      <form className="group space-y-4">
        <input type="hidden" name="id" value={item.id} />
        <fieldset><legend className="label">Type</legend>
          <div className="flex flex-wrap gap-2">{([["SINGLE", "Single image"], ["CAROUSEL", "Carousel (3 to 8 slides)"]] as const).map(([k, l]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
              <input type="radio" name="kind" value={k} defaultChecked={kind === k} className="sr-only" />{l}</label>
          ))}</div></fieldset>
        {claudeOn && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
            <div className="min-w-56 flex-1"><label className="label" htmlFor="designNote">Note for AI <span className="font-normal text-muted">(optional)</span></label>
              <input id="designNote" name="designNote" maxLength={300} placeholder="e.g. focus on free delivery, use Roman Urdu" className="input" /></div>
            <SubmitButton formAction={designWords} className="btn-ghost" pendingText="Writing…">Write words with AI</SubmitButton>
            {imagesOn && <SubmitButton formAction={designAiPhoto} className="btn-ghost" pendingText="Making the photo…">New AI photo</SubmitButton>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2 group-has-[input[name=kind][value=CAROUSEL]:checked]:hidden"><label className="label" htmlFor="headline">Headline <span className="font-normal text-muted">(8 words or fewer)</span></label>
            <input id="headline" name="headline" maxLength={LIMITS.headline} defaultValue={design?.headline ?? ""} className="input" /></div>
          <div className="sm:col-span-2 group-has-[input[name=kind][value=CAROUSEL]:checked]:hidden"><label className="label" htmlFor="sub">Sub line <span className="font-normal text-muted">(optional)</span></label>
            <input id="sub" name="sub" maxLength={LIMITS.sub} defaultValue={design?.sub ?? ""} className="input" /></div>
          <fieldset className="hidden space-y-2 sm:col-span-2 group-has-[input[name=kind][value=CAROUSEL]:checked]:block"><legend className="label">Slides <span className="font-normal text-muted">(slide 1 is the cover, the last one gets the button; leave rows empty to use fewer)</span></legend>
            {Array.from({ length: LIMITS.slidesMax }, (_, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[2rem_1fr_1.4fr] sm:items-center">
                <span className="text-xs text-muted">{i + 1}</span>
                <input name={`slide_h_${i}`} aria-label={`Slide ${i + 1} headline`} maxLength={LIMITS.headline} defaultValue={slides[i]?.headline ?? ""} placeholder={i === 0 ? "Cover headline" : "Headline"} className="input" />
                <input name={`slide_s_${i}`} aria-label={`Slide ${i + 1} text`} maxLength={LIMITS.slideSub} defaultValue={slides[i]?.sub ?? ""} placeholder="Text (optional)" className="input" />
              </div>
            ))}
          </fieldset>
          <div><label className="label" htmlFor="cta">Button text <span className="font-normal text-muted">(optional)</span></label>
            <input id="cta" name="cta" maxLength={LIMITS.cta} defaultValue={design?.cta ?? ""} placeholder="Order now" className="input" /></div>
          <div><label className="label" htmlFor="label">Small tag <span className="font-normal text-muted">(optional)</span></label>
            <input id="label" name="label" maxLength={LIMITS.label} defaultValue={design?.label ?? ""} placeholder="Limited offer" className="input" /></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="layout">Layout <span className="font-normal text-muted group-has-[input[name=kind][value=SINGLE]:checked]:hidden">(cover slide)</span></label>
            <select id="layout" name="layout" key={layoutValue} defaultValue={layoutValue} className="input">
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

      {recent.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-medium">Recent designs for this client</h3>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {recent.map((r) => (
              <figure key={r.id} className="w-28 shrink-0 space-y-1">
                <Link href={`/content/${r.itemId}`} title={r.title}><img src={link(r.fileId)} alt={r.title} className="h-28 w-28 rounded-lg border border-border object-cover" /></Link>
                <figcaption className="text-xs"><span className="block truncate text-muted">{r.kind === "CAROUSEL" ? "Carousel · " : ""}{DESIGN_LAYOUTS[r.layout as keyof typeof DESIGN_LAYOUTS]?.label ?? r.layout}</span>
                  <Link className="underline" href={`/content/${item.id}?style=${r.id}#design`}>Use this style</Link></figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
