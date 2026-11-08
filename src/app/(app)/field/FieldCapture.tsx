"use client";

// The field agent's capture screen. Everything is saved on the phone first (IndexedDB, src/lib/field-queue.ts) and sent when there is
// signal, so a shop with no coverage is logged like any other. Photos come from the rear camera through a plain file input with
// capture="environment" (no extra permission code) and are resized on the phone before they are stored. Location is read when the form
// opens and again when it is saved; it is never read in the background.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/shell/Icon";
import { compressImage, hasIndexedDb, listVisits, newClientRef, pruneSent, putVisit, deleteVisit, syncQueue, type QueuedPhoto, type QueuedVisit } from "@/lib/field-queue";

type Country = { code: string; label: string };
type Revisit = { id: string; name: string; phone: string | null; address: string | null; contactName: string | null; lastOutcome: string | null; lastVisitAt: string | null };
type Props = { ready: boolean; countries: Country[]; defaultCountry: string; productName: string | null; businessLabel: string | null; serverCount: number; target: number; revisits: Revisit[] };

const OUTCOMES: { key: string; label: string; hint: string; tone: string }[] = [
  { key: "NOT_AVAILABLE", label: "Not available", hint: "Nobody to talk to", tone: "border-border" },
  { key: "CLOSED", label: "Closed", hint: "Shutter down", tone: "border-border" },
  { key: "OWNER_ABSENT", label: "Owner absent", hint: "Staff only, come back", tone: "border-border" },
  { key: "NOT_INTERESTED", label: "Not interested", hint: "Said no", tone: "border-brand/40" },
  { key: "INTERESTED", label: "Interested", hint: "Wants to know more", tone: "border-success/50" },
  { key: "DEMO_REQUESTED", label: "Demo requested", hint: "Asked for a demo", tone: "border-success/50" },
];
const OUTCOME_LABEL: Record<string, string> = { ...Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label])), DEMO_CANCELLED: "Demo not booked" };
const MAX_PHOTOS = 6;
type Fix = { lat: number; lng: number; accuracyM: number; at: number } | null;

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

function useLocation(active: boolean) {
  const [fix, setFix] = useState<Fix>(null);
  const [state, setState] = useState<"idle" | "asking" | "ok" | "denied" | "unavailable">("idle");
  const read = useCallback(() => {
    if (!("geolocation" in navigator)) { setState("unavailable"); return; }
    setState("asking");
    navigator.geolocation.getCurrentPosition(
      (p) => { setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), at: Date.now() }); setState("ok"); },
      (e) => { setState(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"); },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 20_000 },
    );
  }, []);
  useEffect(() => { if (active) read(); }, [active, read]);
  return { fix, state, read };
}

function Field({ id, label, error, hint, children, optional }: { id: string; label: string; error?: string; hint?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}{optional && <span className="font-normal text-muted"> (optional)</span>}</label>
      {children}
      {error ? <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-brand">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export default function FieldCapture({ ready, countries, defaultCountry, productName, businessLabel, serverCount, target, revisits }: Props) {
  const router = useRouter();
  const online = useOnline();
  const [queue, setQueue] = useState<QueuedVisit[]>([]);
  const [open, setOpen] = useState<null | { revisit?: Revisit; fix?: QueuedVisit }>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const refresh = useCallback(async () => { try { setQueue(await listVisits()); } catch { setStorageOk(false); } }, []);

  // The queue is sent on load, whenever the connection returns, whenever the app comes back to the front, and after each save
  const sync = useCallback(async () => {
    if (!hasIndexedDb()) return;
    const r = await syncQueue(refresh);
    if (r.sent > 0) { setBanner({ kind: "ok", text: `${r.sent} visit${r.sent === 1 ? "" : "s"} sent.` }); router.refresh(); }
    if (r.signedOut) setBanner({ kind: "error", text: "Your sign-in has expired. Sign in again; your visits are kept on this phone." });
    if (r.refused > 0 && r.sent === 0) setBanner({ kind: "error", text: `${r.refused} visit${r.refused === 1 ? " was" : "s were"} not accepted. See below.` });
  }, [refresh, router]);
  useEffect(() => {
    if (!hasIndexedDb()) { setStorageOk(false); return; }
    pruneSent().then(refresh).then(sync);
    const vis = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("online", sync); document.addEventListener("visibilitychange", vis);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { /* the page still works, just not offline */ });
    return () => { window.removeEventListener("online", sync); document.removeEventListener("visibilitychange", vis); };
  }, [refresh, sync]);

  const waiting = queue.filter((v) => v.status === "QUEUED" || v.status === "SENDING");
  const refused = queue.filter((v) => v.status === "REFUSED");
  const sentHere = queue.filter((v) => v.status === "SENT");
  // Today's count = what the server has + what this phone still holds (each waiting visit is a business visited)
  const count = serverCount + waiting.length;
  const pct = target > 0 ? Math.min(100, Math.round((count / target) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div><p className="text-xs uppercase tracking-wide text-muted">Today</p><p className="text-3xl font-semibold tabular-nums">{count} <span className="text-base font-normal text-muted">/ {target}</span></p></div>
          <div className="text-right text-xs text-muted">
            <p>{online ? "Online" : "Offline: visits are saved on this phone"}</p>
            {waiting.length > 0 && <p className="text-warning">{waiting.length} waiting to send</p>}
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={count} aria-valuemin={0} aria-valuemax={target} aria-label="Visits today"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
        <button type="button" className="btn w-full !py-3 text-base" disabled={!ready || !storageOk} onClick={() => { setBanner(null); setOpen({}); }}><Icon name="plus" /> New visit</button>
        {!storageOk && <p className="text-xs text-brand">This browser cannot store visits offline (private mode?). Open Hifi One from the home-screen icon or a normal tab.</p>}
        {waiting.length > 0 && online && <button type="button" className="btn-ghost w-full" onClick={sync}>Send now</button>}
      </div>
      {banner && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${banner.kind === "ok" ? "bg-success/10 text-success" : "bg-brand/10 text-brand"}`}>{banner.text}</p>}

      {refused.length > 0 && (
        <section className="space-y-2" aria-labelledby="refused-h">
          <h2 id="refused-h" className="font-semibold text-brand">Not accepted <span className="text-sm font-normal text-muted">({refused.length})</span></h2>
          <ul className="space-y-2">{refused.map((v) => (
            <li key={v.id} className="card space-y-2 border-brand/30">
              <p className="font-medium">{v.fields.name || "Visit"} <span className="text-xs font-normal text-muted">· {OUTCOME_LABEL[v.fields.outcome] ?? v.fields.outcome}</span></p>
              <p className="text-sm text-brand">{v.error}</p>
              <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => setOpen({ fix: v })}>Fix and resend</button><button type="button" className="btn-ghost" onClick={async () => { await deleteVisit(v.id); refresh(); }}>Discard</button></div>
            </li>
          ))}</ul>
        </section>
      )}

      {(waiting.length > 0 || sentHere.length > 0) && (
        <section className="space-y-2" aria-labelledby="phone-h">
          <h2 id="phone-h" className="font-semibold">On this phone</h2>
          <ul className="card !p-0 divide-y divide-border">{[...waiting, ...sentHere].map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0"><p className="truncate font-medium">{v.result?.prospectName ?? v.fields.name ?? "Visit"}</p><p className="text-xs text-muted">{OUTCOME_LABEL[v.fields.outcome] ?? v.fields.outcome}{v.photos.length ? ` · ${v.photos.length} photo${v.photos.length === 1 ? "" : "s"}` : ""}{v.result?.revisit ? " · added to an earlier visit" : ""}{v.result?.alsoProspectFor?.length ? ` · also a prospect for ${v.result.alsoProspectFor.join(", ")}` : ""}</p></div>
              <span className={`shrink-0 text-xs ${v.status === "SENT" ? "text-success" : "text-warning"}`}>{v.status === "SENT" ? "Sent" : v.status === "SENDING" ? "Sending…" : "Waiting"}</span>
            </li>
          ))}</ul>
        </section>
      )}

      {revisits.length > 0 && (
        <section className="space-y-2" aria-labelledby="revisit-h">
          <h2 id="revisit-h" className="font-semibold">Go back to <span className="text-sm font-normal text-muted">({revisits.length})</span></h2>
          <ul className="card !p-0 divide-y divide-border">{revisits.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0"><p className="truncate font-medium">{r.name}</p><p className="truncate text-xs text-muted">{[OUTCOME_LABEL[r.lastOutcome ?? ""] ?? r.lastOutcome, r.lastVisitAt, r.address].filter(Boolean).join(" · ")}</p></div>
              <button type="button" className="btn-ghost shrink-0" disabled={!ready || !storageOk} onClick={() => { setBanner(null); setOpen({ revisit: r }); }}>Visit again</button>
            </li>
          ))}</ul>
        </section>
      )}

      {open && (
        <VisitSheet countries={countries} defaultCountry={defaultCountry} productName={productName} businessLabel={businessLabel} revisit={open.revisit} fix={open.fix}
          onClose={() => setOpen(null)}
          onSaved={async (msg) => { setOpen(null); setBanner({ kind: "ok", text: msg }); await refresh(); sync(); }} />
      )}
    </div>
  );
}

// ---------- the form ----------
function VisitSheet({ countries, defaultCountry, productName, businessLabel, revisit, fix, onClose, onSaved }: { countries: Country[]; defaultCountry: string; productName: string | null; businessLabel: string | null; revisit?: Revisit; fix?: QueuedVisit; onClose: () => void; onSaved: (msg: string) => void }) {
  const { fix: loc, state: locState, read: readLocation } = useLocation(true);
  const [outcome, setOutcome] = useState<string>(fix?.fields.outcome ?? "");
  const [photos, setPhotos] = useState<QueuedPhoto[]>(fix?.photos ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; field?: string | null } | null>(fix?.error ? { text: fix.error, field: fix.field } : null);
  const nameRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLInputElement>(null);
  const premisesRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p.blob)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); document.body.style.overflow = "hidden";
    if (!revisit) nameRef.current?.focus();
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose, revisit]);
  const f = fix?.fields ?? {};
  const err = (name: string) => (error && error.field === name ? error.text : undefined);
  const hasCard = photos.some((p) => p.category === "VISITING_CARD");

  async function addPhotos(files: FileList | null, category: QueuedPhoto["category"]) {
    if (!files || files.length === 0) return;
    setBusy("Preparing photo…");
    try {
      const next = [...photos];
      for (const file of Array.from(files)) {
        if (next.length >= MAX_PHOTOS) break;
        if (!file.type.startsWith("image/")) continue;
        const blob = await compressImage(file);
        if (category === "VISITING_CARD") { const i = next.findIndex((p) => p.category === "VISITING_CARD"); if (i >= 0) next.splice(i, 1); }
        next.push({ category, blob, name: `${category.toLowerCase()}-${Date.now()}.jpg` });
      }
      setPhotos(next);
    } finally { setBusy(null); if (cardRef.current) cardRef.current.value = ""; if (premisesRef.current) premisesRef.current.value = ""; }
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    const fields: Record<string, string> = {};
    for (const [k, v] of data.entries()) if (typeof v === "string") fields[k] = v.trim();
    if (!outcome) { setError({ text: "Choose what happened at the visit.", field: "outcome" }); return; }
    fields.outcome = outcome;
    if (!revisit && !fields.name) { setError({ text: "Enter the business's name.", field: "name" }); nameRef.current?.focus(); return; }
    if (revisit) fields.prospectId = revisit.id;
    fields.visitedAt = new Date().toISOString();
    if (loc) { fields.lat = String(loc.lat); fields.lng = String(loc.lng); fields.accuracyM = String(loc.accuracyM); }
    setBusy("Saving on this phone…");
    try {
      const v: QueuedVisit = { id: fix?.id ?? newClientRef(), fields, photos, status: "QUEUED", createdAt: fix?.createdAt ?? Date.now(), attempts: 0 };
      await putVisit(v);
      onSaved(`${fields.name || revisit?.name || "Visit"} saved. ${navigator.onLine ? "Sending…" : "It will be sent when you are back online."}`);
    } catch {
      setError({ text: "The visit could not be saved on this phone. Free some space or try again." });
    } finally { setBusy(null); }
  }

  const locLine = locState === "asking" ? "Finding your location…" : locState === "ok" && loc ? `Location found (within ${loc.accuracyM} m)` : locState === "denied" ? "Location is off for this app. The visit is saved without it; allow location in your phone's settings for next time." : locState === "unavailable" ? "Location not available right now. The visit is saved without it." : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="New visit">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div><h2 className="text-lg font-semibold tracking-tight">{revisit ? `Visit again: ${revisit.name}` : fix ? "Fix and resend" : "New visit"}</h2>{productName && <p className="text-xs text-muted">{productName}{businessLabel ? ` · ${businessLabel}` : ""}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-foreground"><Icon name="close" /></button>
        </header>
        <form onSubmit={save} noValidate className="space-y-4 p-4">
          <p className={`flex items-start gap-2 text-xs ${locState === "ok" ? "text-success" : "text-muted"}`}><Icon name="pin" /><span>{locLine}{(locState === "denied" || locState === "unavailable") && <> <button type="button" className="underline" onClick={readLocation}>Try again</button></>}</span></p>

          <fieldset>
            <legend className="label">Photos <span className="font-normal text-muted">({photos.length} of {MAX_PHOTOS})</span></legend>
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-3 py-4 text-center text-sm ${hasCard ? "border-success/50 bg-success/5" : "border-border"}`}>
                <Icon name="upload" /><span className="font-medium">{hasCard ? "Retake visiting card" : "Visiting card"}</span><span className="text-xs text-muted">One photo</span>
                <input ref={cardRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => addPhotos(e.target.files, "VISITING_CARD")} disabled={Boolean(busy)} />
              </label>
              <label className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border px-3 py-4 text-center text-sm ${photos.length >= MAX_PHOTOS ? "opacity-50" : "cursor-pointer"}`}>
                <Icon name="upload" /><span className="font-medium">Premises</span><span className="text-xs text-muted">Storefront, board, inside</span>
                <input ref={premisesRef} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files, "PREMISES")} disabled={Boolean(busy) || photos.length >= MAX_PHOTOS} />
              </label>
            </div>
            {photos.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">{photos.map((p, i) => (
                <li key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previews[i]} alt={p.category === "VISITING_CARD" ? "Visiting card" : "Premises"} className="h-20 w-20 rounded-lg object-cover" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{p.category === "VISITING_CARD" ? "Card" : "Premises"}</span>
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-surface p-0.5 shadow"><Icon name="close" /></button>
                </li>
              ))}</ul>
            )}
            {busy && <p className="mt-1 text-xs text-muted">{busy}</p>}
          </fieldset>

          {!revisit && (
            <Field id="fv-name" label={`${businessLabel ?? "Business"} name`} error={err("name")}>
              <input ref={nameRef} id="fv-name" name="name" required maxLength={160} autoComplete="off" defaultValue={f.name ?? ""} className="input" aria-invalid={Boolean(err("name"))} />
            </Field>
          )}
          {revisit && <p className="rounded-lg bg-hover px-3 py-2 text-sm">{revisit.name}{revisit.phone ? ` · ${revisit.phone}` : ""}{revisit.address ? ` · ${revisit.address}` : ""}</p>}
          <Field id="fv-owner" label="Owner or contact name" optional error={err("ownerName")}>
            <input id="fv-owner" name="ownerName" maxLength={120} autoComplete="off" defaultValue={f.ownerName ?? revisit?.contactName ?? ""} className="input" />
          </Field>
          <Field id="fv-phone" label="Phone" optional={!revisit} error={err("phone")} hint={revisit?.phone ? "Already on record; add only if it changed." : "Type it as you would dial it. Needed before this can become a lead."}>
            <div className="flex gap-2">
              <select name="country" defaultValue={f.country ?? defaultCountry} aria-label="Country code" className="input !w-[9.5rem] shrink-0">{countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
              <input id="fv-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" maxLength={40} defaultValue={f.phone ?? ""} placeholder="0300 1234567" className="input min-w-0 flex-1" aria-invalid={Boolean(err("phone"))} />
            </div>
          </Field>
          <Field id="fv-email" label="Email" optional error={err("email")}>
            <input id="fv-email" name="email" type="email" inputMode="email" autoComplete="off" maxLength={200} defaultValue={f.email ?? ""} className="input" aria-invalid={Boolean(err("email"))} />
          </Field>
          {!revisit && (
            <Field id="fv-address" label="Address or landmark" optional>
              <input id="fv-address" name="address" maxLength={300} autoComplete="off" defaultValue={f.address ?? ""} placeholder="Shop 12, Main Market, near the bank" className="input" />
            </Field>
          )}

          <fieldset>
            <legend className="label">What happened?</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Outcome">
              {OUTCOMES.map((o) => (
                <button key={o.key} type="button" role="radio" aria-checked={outcome === o.key} onClick={() => setOutcome(o.key)}
                  className={`rounded-xl border-2 px-3 py-3 text-left transition ${outcome === o.key ? "border-primary bg-primary/10" : `${o.tone} bg-surface`}`}>
                  <span className="block text-sm font-medium">{o.label}</span><span className="block text-xs text-muted">{o.hint}</span>
                </button>
              ))}
            </div>
            {err("outcome") && <p role="alert" className="mt-1 text-xs text-brand">{err("outcome")}</p>}
          </fieldset>
          <Field id="fv-reason" label="Reason or what they said" optional>
            <input id="fv-reason" name="reason" maxLength={500} autoComplete="off" defaultValue={f.reason ?? ""} placeholder={outcome === "NOT_INTERESTED" ? "Uses other software, no budget…" : outcome === "DEMO_REQUESTED" ? "Preferred day and time" : "Owner back after 4pm, closed on Fridays…"} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="fv-follow" label="Go back on" optional><input id="fv-follow" name="followUpOn" type="date" defaultValue={f.followUpOn ?? ""} className="input" /></Field>
            <Field id="fv-city" label="City" optional><input id="fv-city" name="city" maxLength={80} defaultValue={f.city ?? ""} className="input" /></Field>
          </div>
          <Field id="fv-note" label="Other details" optional>
            <textarea id="fv-note" name="note" rows={2} maxLength={1000} defaultValue={f.note ?? ""} className="input" />
          </Field>
          {error && error.field === "name" && /same business/.test(error.text) && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="differentBusiness" value="1" className="mt-0.5" /> Different business (another branch with the same name)</label>}
          {error && !["name", "phone", "email", "outcome", "ownerName"].includes(error.field ?? "") && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{error.text}</p>}
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-border bg-background px-4 py-3">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn !px-6 !py-2.5" disabled={Boolean(busy)} aria-disabled={Boolean(busy)}>{busy ? busy : "Save visit"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
