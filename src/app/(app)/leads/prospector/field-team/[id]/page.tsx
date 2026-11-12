import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, Notice, PageHeader, SubmitButton } from "@/components/ui";
import ProjectAssets from "../../../../projects/[id]/ProjectAssets";
import { createProductAssetsAction, linkProductAssetsAction, saveProductDetailsAction } from "../actions";

export const dynamic = "force-dynamic";

// One product's details page: what agents need to pitch it, and its brand assets (brand guide, logos, videos, creatives), which live in
// a project's asset library so versions, previews and no-login share links work the same as everywhere else.
export default async function ProductDetails({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; folder?: string; assetError?: string; assetOk?: string }>;
}) {
  const user = await requirePermission("field.review");
  const { id } = await params;
  const sp = await searchParams;
  const product = await db.saasProduct.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!product) notFound();
  const base = `/leads/prospector/field-team/${product.id}`;
  const project = product.assetsProjectId ? await db.project.findFirst({ where: { id: product.assetsProjectId, organizationId: user.organizationId }, select: { id: true, name: true, number: true } }) : null;
  const projects = await db.project.findMany({ where: { organizationId: user.organizationId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, name: true, number: true } });
  const canProjects = user.permissions.has("projects.view");

  const show = (label: string, v: string | null) => v ? <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-0.5 whitespace-pre-line text-sm">{v}</dd></div> : null;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={product.name}
        subtitle={product.tagline ?? `${product.businessLabel} product · ${product.code}`}
        actions={<><Link className="btn-ghost" href="/leads/prospector/field-team">Back to products</Link>{product.website && <a className="btn-ghost" href={product.website} target="_blank" rel="noopener noreferrer">Website</a>}</>}
      />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <section className="card space-y-4" aria-labelledby="details-h">
        <div className="flex items-baseline justify-between gap-2"><h2 id="details-h" className="font-semibold">Product details</h2>{product.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">off</Badge>}</div>
        {(product.description || product.targetCustomers || product.keyFeatures || product.pricing || product.demoUrl || product.pitchNotes) ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            {show("What it is", product.description)}
            {show("Who it is for", product.targetCustomers)}
            {show("Key features", product.keyFeatures)}
            {show("Pricing", product.pricing)}
            {product.demoUrl && <div><dt className="text-xs text-muted">Demo link</dt><dd className="mt-0.5 text-sm"><a className="text-primary hover:underline break-all" href={product.demoUrl} target="_blank" rel="noopener noreferrer">{product.demoUrl}</a></dd></div>}
            {show("Pitch notes", product.pitchNotes)}
          </dl>
        ) : <p className="text-sm text-muted">Nothing written yet. Fill in the form below so every agent pitches {product.name} the same way.</p>}

        <details className="rounded-xl border border-border p-3" open={!product.description}>
          <summary className="cursor-pointer text-sm font-medium">Edit details</summary>
          <form action={saveProductDetailsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={product.id} />
            <div className="sm:col-span-2"><label className="label" htmlFor="d-tag">One-line pitch</label><input id="d-tag" name="tagline" className="input" maxLength={140} defaultValue={product.tagline ?? ""} placeholder="Run your whole pharmacy from one screen" /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="d-desc">What it is</label><textarea id="d-desc" name="description" className="input min-h-24" maxLength={4000} defaultValue={product.description ?? ""} /></div>
            <div><label className="label" htmlFor="d-who">Who it is for</label><textarea id="d-who" name="targetCustomers" className="input min-h-20" maxLength={1500} defaultValue={product.targetCustomers ?? ""} placeholder={`${product.businessLabel} owners and managers`} /></div>
            <div><label className="label" htmlFor="d-feat">Key features (one per line)</label><textarea id="d-feat" name="keyFeatures" className="input min-h-20" maxLength={4000} defaultValue={product.keyFeatures ?? ""} /></div>
            <div><label className="label" htmlFor="d-price">Pricing</label><textarea id="d-price" name="pricing" className="input min-h-20" maxLength={2000} defaultValue={product.pricing ?? ""} placeholder="Plans, per-month price, setup fee, discounts agents may offer" /></div>
            <div><label className="label" htmlFor="d-demo">Demo link</label><input id="d-demo" name="demoUrl" type="url" className="input" maxLength={300} defaultValue={product.demoUrl ?? ""} placeholder="https://" /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="d-notes">Pitch notes</label><textarea id="d-notes" name="pitchNotes" className="input min-h-24" maxLength={4000} defaultValue={product.pitchNotes ?? ""} placeholder="Common objections and answers, what to say first, what never to promise" /></div>
            <div className="sm:col-span-2"><SubmitButton pendingText="Saving…">Save details</SubmitButton></div>
          </form>
        </details>
      </section>

      <section className="space-y-3" aria-labelledby="brand-h">
        <h2 id="brand-h" className="font-semibold">Brand assets</h2>
        {project ? (
          <>
            <p className="text-sm text-muted">Library: <span className="font-medium text-foreground">{project.number} {project.name}</span>{canProjects && <> · <Link className="text-primary hover:underline" href={`/projects/${project.id}`}>open project</Link></>}. Folders, versions, previews and no-login share links work as on any project.</p>
            {canProjects
              ? <ProjectAssets user={user} projectId={project.id} folder={sp.folder} basePath={base} flash={{ assetError: sp.assetError, assetOk: sp.assetOk }} />
              : <Notice kind="error">You need the Projects permission to see the files.</Notice>}
            <form action={linkProductAssetsAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={product.id} />
              <div><label className="label" htmlFor="l-proj">Use a different project&apos;s library</label>
                <select id="l-proj" name="projectId" className="input" defaultValue={project.id}>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></div>
              <SubmitButton pendingText="Saving…">Switch library</SubmitButton>
            </form>
            <form action={linkProductAssetsAction}><input type="hidden" name="id" value={product.id} /><input type="hidden" name="projectId" value="" /><SubmitButton pendingText="Saving…">Detach library</SubmitButton></form>
          </>
        ) : (
          <div className="card space-y-4">
            <p className="text-sm text-muted">No brand assets yet. Brand guides, logos, videos and creatives are kept in a project&apos;s asset library. Create one for {product.name}, or point to a project that already holds them.</p>
            <form action={createProductAssetsAction}><input type="hidden" name="id" value={product.id} /><SubmitButton pendingText="Creating…">Create brand assets library</SubmitButton></form>
            {projects.length > 0 && <form action={linkProductAssetsAction} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
              <input type="hidden" name="id" value={product.id} />
              <div><label className="label" htmlFor="l-proj2">Or use an existing project</label><select id="l-proj2" name="projectId" className="input" required defaultValue=""><option value="" disabled>Choose a project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></div>
              <SubmitButton pendingText="Saving…">Use this library</SubmitButton>
            </form>}
          </div>
        )}
      </section>
    </div>
  );
}
