import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { signDownload } from "@/lib/files";
import { COLOR_LABEL, COLOR_ROLES, FONTS, LOGO_CORNERS, LOGO_SLOTS, LOGO_SLOT_LABEL, MEDIA_FOLDERS, cleanColors, getKit, listMedia, postCreatives, type LogoSlot, type Suggestion } from "@/lib/brand-kit";
import { ConfirmButton, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { applySuggestionAction, dismissSuggestionAction, removeMediaAction, saveKitAction, suggestAction, updateMediaAction, uploadMediaAction, useAsLogoAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { client?: string; tab?: string; folder?: string; q?: string; ok?: string; error?: string };
const DEFAULT_HEX: Record<string, string> = { PRIMARY: "#4F46E5", SECONDARY: "#0EA5E9", ACCENT: "#F59E0B", TEXT: "#111827", BACKGROUND: "#FFFFFF" };
const CORNER_LABEL: Record<string, string> = { TOP_LEFT: "Top left", TOP_RIGHT: "Top right", BOTTOM_LEFT: "Bottom left", BOTTOM_RIGHT: "Bottom right" };

export default async function BrandKitPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("content.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canEdit = user.permissions.has("content.manage");
  const clients = await db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const clientId = sp.client && sp.client !== "own" ? clients.find((c) => c.id === sp.client)?.id ?? null : null;
  const key = clientId ?? "own";
  const tab = sp.tab === "media" ? "media" : "kit";
  const [kit, media, creatives] = await Promise.all([
    getKit(db, org, clientId),
    listMedia(db, { organizationId: org, clientId, folder: sp.folder && sp.folder !== "__posts" ? sp.folder : undefined, q: sp.q }),
    tab === "media" && (!sp.folder || sp.folder === "__posts") && !sp.q ? postCreatives(db, { organizationId: org, clientId }) : Promise.resolve([]),
  ]);
  const files = await db.storedFile.findMany({ where: { id: { in: media.map((m) => m.fileId).concat([kit?.logoFileId, kit?.logoLightFileId, kit?.iconFileId].filter((x): x is string => Boolean(x))) }, deletedAt: null } });
  const secret = process.env.SESSION_SECRET ?? "";
  const src = (fileId: string | null | undefined) => (fileId && files.some((f) => f.id === fileId) ? `/api/files/${fileId}?t=${signDownload(fileId, user.id, secret, 3600)}` : null);
  const colors = cleanColors(kit?.colors ?? []);
  const sug = kit?.suggestion as Suggestion | null | undefined;
  const folders = [...new Set([...MEDIA_FOLDERS, ...media.map((m) => m.folder)])];
  const hidden = <input type="hidden" name="client" value={key} />;
  const tabHref = (t: string) => `/content/brand?client=${key}&tab=${t}`;
  const name = clientId ? clients.find((c) => c.id === clientId)?.name : "Our own posts";

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader back={{ href: "/content", label: "Content calendar" }} title="Brand kits"
        subtitle="Each client's logos, colours, fonts and media library. AI images use the colours now; branded designs will use all of it." />
      <form method="get" className="card flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <div className="min-w-56 flex-1"><label className="label" htmlFor="bk-client">Brand</label>
          <select id="bk-client" name="client" defaultValue={key} className="input"><option value="own">Our own posts</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="btn-ghost">Open</button>
      </form>
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <nav className="flex gap-1 border-b border-border" aria-label="Brand kit sections">
        {[["kit", "Brand kit"], ["media", `Media library (${media.length})`]].map(([t, label]) => (
          <Link key={t} href={tabHref(t)} aria-current={tab === t ? "page" : undefined} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground"}`}>{label}</Link>
        ))}
      </nav>

      {tab === "kit" ? (
        <>
          {/* Preview */}
          <section className="card flex flex-wrap items-center gap-4" aria-label="Preview">
            <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-border p-2" style={{ background: colors.find((c) => c.role === "BACKGROUND")?.hex ?? "#fff" }}>
              {src(kit?.logoFileId) ? <img src={src(kit?.logoFileId)!} alt={`${name} logo`} className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted">No logo</span>}
            </div>
            <div className="space-y-2">
              <p className="font-semibold">{name}</p>
              <div className="flex gap-1.5">{colors.length ? colors.map((c) => <span key={c.role} title={`${COLOR_LABEL[c.role]} ${c.hex}`} className="h-7 w-7 rounded-full border border-border" style={{ background: c.hex }} />) : <span className="text-sm text-muted">No colours yet</span>}</div>
              <p className="text-xs text-muted">{kit?.headingFont ? `${kit.headingFont} headings` : "No heading font"} · {kit?.bodyFont ? `${kit.bodyFont} text` : "no body font"}{kit?.handle ? ` · ${kit.handle}` : ""}</p>
            </div>
          </section>

          {canEdit && (
            <section className="card space-y-3" aria-label="Fill from website">
              <h2 className="font-semibold">Fill from website</h2>
              <form action={suggestAction} className="flex flex-wrap items-end gap-2">{hidden}
                <div className="min-w-64 flex-1"><label className="label" htmlFor="bk-url">Client&rsquo;s website</label><input id="bk-url" name="url" defaultValue={kit?.website ?? ""} placeholder="example.com" required className="input" /></div>
                <SubmitButton className="btn-ghost" pendingText="Reading the website…">Suggest from website</SubmitButton>
              </form>
              {sug && (
                <form action={applySuggestionAction} className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">{hidden}
                  <p className="text-xs text-muted">Found on {sug.from}</p>
                  {sug.colors.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" name="colors" defaultChecked /> Colours {sug.colors.slice(0, 3).map((h) => <span key={h} title={h} className="h-5 w-5 rounded-full border border-border" style={{ background: h }} />)} <span className="text-xs text-muted">as primary, secondary, accent</span></label>}
                  {sug.fonts.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" name="fonts" defaultChecked /> Fonts: {sug.fonts.join(", ")}</label>}
                  {sug.fonts.length === 0 && sug.otherFonts.length > 0 && <p className="text-xs text-muted">The site uses {sug.otherFonts.join(", ")}, not in our font list. Pick the closest below.</p>}
                  {sug.logoUrl && <label className="flex items-center gap-2"><input type="checkbox" name="logo" defaultChecked /> Download the logo found on the site (<a href={sug.logoUrl} target="_blank" rel="noopener noreferrer" className="underline">view</a>)</label>}
                  {sug.iconUrl && <label className="flex items-center gap-2"><input type="checkbox" name="icon" /> Download the site icon (<a href={sug.iconUrl} target="_blank" rel="noopener noreferrer" className="underline">view</a>)</label>}
                  {(sug.phone || sug.whatsapp || sug.handle) && <label className="flex items-center gap-2"><input type="checkbox" name="contact" defaultChecked /> Contact: {[sug.phone, sug.whatsapp && `WhatsApp ${sug.whatsapp}`, sug.handle].filter(Boolean).join(" · ")}</label>}
                  {!sug.colors.length && !sug.fonts.length && !sug.logoUrl && <p>Nothing useful was found. Fill the kit by hand.</p>}
                  <div className="flex gap-2"><SubmitButton className="btn" pendingText="Applying…">Apply ticked</SubmitButton><button formAction={dismissSuggestionAction} className="btn-ghost">Dismiss</button></div>
                </form>
              )}
            </section>
          )}

          <section className="card space-y-3" aria-label="Logos">
            <h2 className="font-semibold">Logos</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(LOGO_SLOTS) as LogoSlot[]).map((slot) => {
                const url = src(kit?.[LOGO_SLOTS[slot]]);
                return (
                  <div key={slot} className="space-y-2 rounded-xl border border-border p-3">
                    <p className="text-sm font-medium">{LOGO_SLOT_LABEL[slot]}</p>
                    <div className={`flex h-20 items-center justify-center rounded-lg ${slot === "LOGO_LIGHT" ? "bg-gray-800" : "bg-hover"}`}>{url ? <img src={url} alt={LOGO_SLOT_LABEL[slot]} className="max-h-16 max-w-full object-contain" /> : <span className="text-xs text-muted">None</span>}</div>
                    {canEdit && (
                      <form action={uploadMediaAction} className="space-y-1">{hidden}<input type="hidden" name="slot" value={slot} />
                        <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" required aria-label={`Upload ${LOGO_SLOT_LABEL[slot]}`} className="block w-full text-xs" />
                        <SubmitButton className="btn-ghost text-xs" pendingText="Uploading…">{url ? "Replace" : "Upload"}</SubmitButton>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted">PNG with a transparent background or SVG works best. Logos are kept in the media library under Logos.</p>
          </section>

          <form action={saveKitAction} className="card grid gap-4" aria-label="Brand kit">{hidden}
            <fieldset disabled={!canEdit} className="grid gap-4">
              <div><h2 className="font-semibold">Colours</h2>
                <div className="mt-2 grid gap-3 sm:grid-cols-5">
                  {COLOR_ROLES.map((role) => { const c = colors.find((x) => x.role === role); return (
                    <div key={role} className="space-y-1">
                      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name={`c_${role}_on`} value="1" defaultChecked={Boolean(c)} />{COLOR_LABEL[role]}</label>
                      <input type="color" name={`c_${role}`} defaultValue={c?.hex ?? DEFAULT_HEX[role]} aria-label={`${COLOR_LABEL[role]} colour`} className="h-10 w-full cursor-pointer rounded-lg border border-border" />
                    </div>); })}
                </div>
                <p className="mt-1 text-xs text-muted">Tick the colours the brand uses. Unticked ones are not used.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[["headingFont", "Heading font", kit?.headingFont], ["bodyFont", "Body font", kit?.bodyFont]].map(([n, label, v]) => (
                  <div key={n}><label className="label" htmlFor={`bk-${n}`}>{label}</label><select id={`bk-${n}`} name={n!} defaultValue={v ?? ""} className="input"><option value="">Not set</option>{FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
                ))}
              </div>
              <div><h2 className="font-semibold">Contact strip</h2><p className="text-xs text-muted">Shown along the bottom of designs. Leave empty what should not appear.</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div><label className="label" htmlFor="bk-phone">Phone</label><input id="bk-phone" name="phone" defaultValue={kit?.phone ?? ""} className="input" /></div>
                  <div><label className="label" htmlFor="bk-wa">WhatsApp</label><input id="bk-wa" name="whatsapp" defaultValue={kit?.whatsapp ?? ""} className="input" /></div>
                  <div><label className="label" htmlFor="bk-web">Website</label><input id="bk-web" name="website" defaultValue={kit?.website ?? ""} placeholder="https://" className="input" /></div>
                  <div><label className="label" htmlFor="bk-handle">Social handle</label><input id="bk-handle" name="handle" defaultValue={kit?.handle ?? ""} placeholder="@brand" className="input" /></div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="bk-corner">Logo corner</label><select id="bk-corner" name="logoCorner" defaultValue={kit?.logoCorner ?? "TOP_RIGHT"} className="input">{LOGO_CORNERS.map((c) => <option key={c} value={c}>{CORNER_LABEL[c]}</option>)}</select></div>
                <div><label className="label" htmlFor="bk-size">Logo size (% of width)</label><input id="bk-size" name="logoSizePct" type="number" min={6} max={30} defaultValue={kit?.logoSizePct ?? 14} className="input" /></div>
              </div>
              <div><label className="label" htmlFor="bk-rules">Brand rules <span className="font-normal text-muted">(optional)</span></label><textarea id="bk-rules" name="rules" rows={3} maxLength={1000} defaultValue={kit?.rules ?? ""} placeholder="e.g. Logo always on white. Never use red. Show the product, not people." className="input" /></div>
            </fieldset>
            {canEdit && <div><SubmitButton className="btn" pendingText="Saving…">Save brand kit</SubmitButton></div>}
            <p className="text-xs text-muted">Tone of voice, audience and things to avoid stay in the content profile under <Link className="underline" href={`/content/plan${clientId ? `?client=${clientId}` : ""}`}>Plan the month</Link>.</p>
          </form>
        </>
      ) : (
        <>
          {canEdit && (
            <form action={uploadMediaAction} className="card grid gap-3 sm:grid-cols-4 sm:items-end" aria-label="Add to the library">{hidden}
              <div className="sm:col-span-2"><label className="label" htmlFor="md-file">Images <span className="font-normal text-muted">(up to 10 at a time)</span></label><input id="md-file" type="file" name="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" required className="block w-full text-sm" /></div>
              <div><label className="label" htmlFor="md-folder">Folder</label><input id="md-folder" name="folder" list="md-folders" defaultValue={sp.folder && sp.folder !== "__posts" ? sp.folder : "Products"} className="input" /><datalist id="md-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist></div>
              <div><label className="label" htmlFor="md-tags">Tags</label><input id="md-tags" name="tags" placeholder="winter, boots" className="input" /></div>
              <div className="sm:col-span-4"><SubmitButton className="btn" pendingText="Uploading…">Add to library</SubmitButton></div>
            </form>
          )}
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="client" value={key} /><input type="hidden" name="tab" value="media" />
            <div><label className="label" htmlFor="md-q">Search</label><input id="md-q" name="q" defaultValue={sp.q ?? ""} placeholder="title, tag or folder" className="input" /></div>
            <button className="btn-ghost">Search</button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {[["", "All"], ...folders.filter((f) => media.some((m) => m.folder === f) || f === sp.folder).map((f) => [f, f]), ["__posts", "Post creatives"]].map(([v, label]) => (
              <Link key={v || "all"} href={`/content/brand?client=${key}&tab=media${v ? `&folder=${encodeURIComponent(v)}` : ""}`} className={`rounded-full border px-3 py-1 text-xs ${(sp.folder ?? "") === v ? "border-primary bg-primary/10" : "border-border text-muted hover:bg-hover"}`}>{label}</Link>
            ))}
          </div>
          {sp.folder !== "__posts" && (media.length === 0 ? <p className="text-sm text-muted">Nothing here yet. Add product photos, logos and past creatives so designs and the team can reuse them.</p> : (
            <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {media.map((m) => { const f = files.find((x) => x.id === m.fileId); const url = src(m.fileId); return (
                <li key={m.id} className="card space-y-2 !p-2">
                  <a href={url ?? "#"} target="_blank" rel="noopener" className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-hover">{url ? <img src={url} alt={m.title ?? f?.filename ?? "Library image"} loading="lazy" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted">Missing</span>}</a>
                  <p className="truncate text-xs"><span className="font-medium">{m.title ?? f?.filename}</span>{m.byClient && <span className="ml-1 rounded bg-primary/15 px-1 text-[10px]">from client</span>}</p>
                  <p className="truncate text-[11px] text-muted">{m.folder}{m.tags.length ? ` · ${m.tags.map((t) => `#${t}`).join(" ")}` : ""}</p>
                  {canEdit && (
                    <details className="text-xs"><summary className="cursor-pointer text-muted">Edit</summary>
                      <form action={updateMediaAction} className="mt-1 space-y-1">{hidden}<input type="hidden" name="id" value={m.id} />
                        <input name="title" defaultValue={m.title ?? ""} placeholder="Title" aria-label="Title" className="input !py-1 text-xs" />
                        <input name="folder" defaultValue={m.folder} list="md-folders" aria-label="Folder" className="input !py-1 text-xs" />
                        <input name="tags" defaultValue={m.tags.join(", ")} placeholder="tags" aria-label="Tags" className="input !py-1 text-xs" />
                        <SubmitButton className="btn-ghost text-xs" pendingText="Saving…">Save</SubmitButton>
                      </form>
                      <form action={useAsLogoAction} className="mt-1 flex gap-1">{hidden}<input type="hidden" name="id" value={m.id} />
                        <select name="slot" aria-label="Use as" className="input !py-1 text-xs">{(Object.keys(LOGO_SLOTS) as LogoSlot[]).map((s) => <option key={s} value={s}>{LOGO_SLOT_LABEL[s]}</option>)}</select>
                        <button className="btn-ghost text-xs">Use</button>
                      </form>
                      <form action={removeMediaAction} className="mt-1">{hidden}<input type="hidden" name="id" value={m.id} />
                        <ConfirmButton title="Remove this image?" message="It is removed from the library. Posts that already use it keep their own copy." confirmLabel="Remove" className="btn-ghost text-xs">Remove</ConfirmButton>
                      </form>
                    </details>
                  )}
                </li>); })}
            </ul>
          ))}
          {creatives.length > 0 && (
            <section className="space-y-2" aria-label="Post creatives">
              <h2 className="font-semibold">Post creatives</h2>
              <p className="text-xs text-muted">Images already attached to this brand&rsquo;s posts, including AI images. Open the post to see it in context.</p>
              <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {creatives.map(({ file, post }) => (
                  <li key={file.id}><Link href={`/content/${post.id}`} className="block space-y-1">
                    <span className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-hover"><img src={`/api/files/${file.id}?t=${signDownload(file.id, user.id, secret, 3600)}`} alt={post.title} loading="lazy" className="max-h-full max-w-full object-contain" /></span>
                    <span className="block truncate text-[11px] text-muted">{post.title}</span>
                  </Link></li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
