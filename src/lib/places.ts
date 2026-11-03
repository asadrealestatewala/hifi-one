// Google Places API (New) Text Search. Free of Next.js imports. The field mask decides the price: asking for phone, website or rating
// makes each request a "Text Search Enterprise" request, so the mask below lists exactly what the Prospector stores and nothing else.
// Not requested on purpose: opening hours, photos, reviews and coordinates (more cost, and Google limits how long they may be kept).
export const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
export const PLACES_SKU = "PLACES_TEXT_SEARCH_ENTERPRISE";
export const PAGE_SIZE = 20; // Google's maximum per request
export const MAX_RESULTS = 60; // Google returns at most 60 results for one query
export const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.googleMapsUri", "places.websiteUri", "places.internationalPhoneNumber",
  "places.nationalPhoneNumber", "places.rating", "places.userRatingCount", "places.primaryType", "places.businessStatus", "nextPageToken",
].join(",");

export class PlacesError extends Error { constructor(message: string, readonly billable = false) { super(message); } }

export type Place = {
  placeId: string; name: string; address: string | null; website: string | null; internationalPhone: string | null; nationalPhone: string | null;
  mapsUrl: string | null; rating: number | null; ratingCount: number | null; primaryType: string | null; businessStatus: string | null;
};
export type PlacesPage = { places: Place[]; nextPageToken: string | null };

type Raw = { id?: string; displayName?: { text?: string }; formattedAddress?: string; googleMapsUri?: string; websiteUri?: string; internationalPhoneNumber?: string; nationalPhoneNumber?: string; rating?: number; userRatingCount?: number; primaryType?: string; businessStatus?: string };

export function parsePlaces(body: unknown): PlacesPage {
  const b = (body ?? {}) as { places?: Raw[]; nextPageToken?: string };
  const places: Place[] = [];
  for (const r of b.places ?? []) {
    const name = r.displayName?.text?.trim();
    if (!r.id || !name) continue;
    places.push({
      placeId: r.id, name: name.slice(0, 200), address: r.formattedAddress?.slice(0, 300) ?? null, website: httpUrl(r.websiteUri), mapsUrl: httpUrl(r.googleMapsUri),
      internationalPhone: r.internationalPhoneNumber ?? null, nationalPhone: r.nationalPhoneNumber ?? null,
      rating: typeof r.rating === "number" ? Math.round(r.rating * 10) / 10 : null, ratingCount: typeof r.userRatingCount === "number" ? r.userRatingCount : null,
      primaryType: r.primaryType ?? null, businessStatus: r.businessStatus ?? null,
    });
  }
  return { places, nextPageToken: b.nextPageToken || null };
}

// Only http(s) links are kept; anything else (javascript:, data:) is dropped before it can reach a page
export function httpUrl(v: string | undefined | null): string | null {
  if (!v) return null;
  try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 500) : null; } catch { return null; }
}

export async function searchText(p: { apiKey: string; textQuery: string; regionCode?: string; pageToken?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<PlacesPage> {
  const body: Record<string, unknown> = { textQuery: p.textQuery, pageSize: PAGE_SIZE, languageCode: "en" };
  if (p.regionCode) body.regionCode = p.regionCode;
  if (p.pageToken) body.pageToken = p.pageToken;
  let res: Response;
  try {
    res = await (p.fetchImpl ?? fetch)(PLACES_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": p.apiKey, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify(body), signal: AbortSignal.timeout(p.timeoutMs ?? 15_000),
    });
  } catch {
    throw new PlacesError("Google did not answer in time. Nothing was charged; try again in a minute.");
  }
  if (!res.ok) {
    // The key is never echoed back: only Google's own short reason is kept
    let reason = "";
    try { reason = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ""; } catch { /* not JSON */ }
    if (res.status === 429) throw new PlacesError("Google is limiting requests right now. Try again in a few minutes.");
    if (res.status === 400 || res.status === 403) throw new PlacesError(`Google refused the search (${res.status}). Check that the Places API (New) is enabled for the key and billing is on.${reason ? ` Google said: ${reason.slice(0, 160)}` : ""}`);
    throw new PlacesError(`Google could not run the search (${res.status}).`);
  }
  return parsePlaces(await res.json());
}
