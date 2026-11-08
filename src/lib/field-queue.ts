// The field agent's offline queue, in the browser only (IndexedDB). A visit is written here first, always, then sent to /api/field/visits;
// so a visit never depends on the signal in the shop. Each visit carries its own id (clientRef): the server saves a visit with a known
// id once, so a send that was cut off half way is simply sent again.
//
// States: QUEUED (waiting to send) → SENDING → SENT (kept a day, for the list) or REFUSED (the server said no: a duplicate, a bad
// number; the agent fixes or discards it). A network failure or a 5xx leaves it QUEUED and it is tried again on the next sync.
// No Next.js or server imports: this file runs on the phone.

export type QueuedPhoto = { category: "VISITING_CARD" | "PREMISES"; blob: Blob; name: string };
export type QueuedVisit = {
  id: string; // clientRef
  fields: Record<string, string>; // what the form held, as strings, plus lat/lng/accuracyM/visitedAt
  photos: QueuedPhoto[];
  status: "QUEUED" | "SENDING" | "SENT" | "REFUSED";
  createdAt: number;
  attempts: number;
  lastTriedAt?: number;
  error?: string;
  field?: string | null;
  result?: { prospectId: string; prospectName: string; created: boolean; revisit: boolean; needsDetails: boolean; outcome: string; alsoProspectFor: string[]; photos?: { saved: number; skipped: number; errors: string[] } };
};

const DB = "hifi-field";
const STORE = "visits";
const KEEP_SENT_MS = 36 * 3600_000;

export const hasIndexedDb = () => typeof indexedDB !== "undefined";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" }).createIndex("status", "status"); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => d.close();
  }));
}

export const newClientRef = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const putVisit = (v: QueuedVisit) => tx("readwrite", (s) => s.put(v)).then(() => v);
export const getVisit = (id: string) => tx<QueuedVisit | undefined>("readonly", (s) => s.get(id));
export const deleteVisit = (id: string) => tx("readwrite", (s) => s.delete(id));
export async function listVisits(): Promise<QueuedVisit[]> {
  const all = await tx<QueuedVisit[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function pruneSent(now = Date.now()) {
  for (const v of await listVisits()) if (v.status === "SENT" && now - v.createdAt > KEEP_SENT_MS) await deleteVisit(v.id);
}

// ---------- photos ----------
// A phone photo is 3 to 8 MB; forty shops a day would be a few hundred MB. Resized to fit 1600 px and saved as JPEG it is about 200 to 400 KB,
// still plenty to read a visiting card. The browser applies the camera's orientation while decoding, so a portrait shot stays portrait.
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.82): Promise<Blob> {
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return file;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions); } catch { return file; }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return out && out.size < file.size ? out : file;
}

// ---------- sending ----------
export type SendOutcome = { status: "SENT" | "REFUSED" | "RETRY" | "SIGNED_OUT"; message?: string; field?: string | null };

export async function sendVisit(v: QueuedVisit, fetcher: typeof fetch = fetch): Promise<SendOutcome> {
  const body = new FormData();
  body.set("clientRef", v.id);
  for (const [k, val] of Object.entries(v.fields)) if (val !== "" && val !== undefined && val !== null) body.set(k, val);
  for (const p of v.photos) { body.append("photo", p.blob, p.name); body.append("photoCategory", p.category); }
  let res: Response;
  try { res = await fetcher("/api/field/visits", { method: "POST", body, credentials: "same-origin", cache: "no-store" }); }
  catch { return { status: "RETRY", message: "No connection. The visit is saved on this phone and will be sent when you are back online." }; }
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { /* a proxy error page: treat by status */ }
  if (res.ok) { v.result = data as QueuedVisit["result"]; return { status: "SENT" }; }
  if (res.status === 401) return { status: "SIGNED_OUT", message: String(data.error ?? "Sign in again.") };
  if (res.status >= 500 || res.status === 429 || res.status === 408) return { status: "RETRY", message: `The server could not take the visit right now (${res.status}). It will be tried again.` };
  return { status: "REFUSED", message: String(data.error ?? `The visit was refused (${res.status}).`), field: (data.field as string | null | undefined) ?? null };
}

// Send everything that is waiting, oldest first, one at a time (photos are big and the signal in a market is thin). Stops at the first
// network failure or sign-out so the rest keep their order. Returns what changed so the screen can refresh.
let syncing: Promise<{ sent: number; refused: number; waiting: number; signedOut: boolean }> | null = null;
export function syncQueue(onChange?: () => void, fetcher: typeof fetch = fetch) {
  if (syncing) return syncing;
  syncing = (async () => {
    let sent = 0, refused = 0, signedOut = false;
    const all = (await listVisits()).filter((v) => v.status === "QUEUED" || v.status === "SENDING").sort((a, b) => a.createdAt - b.createdAt);
    for (const v of all) {
      v.status = "SENDING"; v.attempts += 1; v.lastTriedAt = Date.now();
      await putVisit(v); onChange?.();
      const r = await sendVisit(v, fetcher);
      if (r.status === "SENT") { v.status = "SENT"; v.error = undefined; v.field = null; v.photos = []; sent++; } // photos are on the server now; free the phone's storage
      else if (r.status === "REFUSED") { v.status = "REFUSED"; v.error = r.message; v.field = r.field; refused++; }
      else { v.status = "QUEUED"; v.error = r.message; }
      await putVisit(v); onChange?.();
      if (r.status === "RETRY") break;
      if (r.status === "SIGNED_OUT") { signedOut = true; break; }
    }
    const waiting = (await listVisits()).filter((v) => v.status === "QUEUED" || v.status === "SENDING").length;
    return { sent, refused, waiting, signedOut };
  })().finally(() => { syncing = null; });
  return syncing;
}
