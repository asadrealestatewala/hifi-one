import { describe, expect, it, vi } from "vitest";
import { FIELD_MASK, PlacesError, httpUrl, parsePlaces, searchText } from "./places";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("Places client", () => {
  it("asks only for the fields it stores, and nothing that costs more", () => {
    expect(FIELD_MASK).not.toMatch(/reviews|photos|regularOpeningHours|location|\*/);
    expect(FIELD_MASK).toContain("nextPageToken");
  });
  it("sends the key in a header, never in the address, and the region and query in the body", async () => {
    const f = vi.fn().mockResolvedValue(ok({ places: [] }));
    await searchText({ apiKey: "KEY123", textQuery: "dentist in Lahore, Pakistan", regionCode: "PK", fetchImpl: f as never });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).not.toContain("KEY123");
    expect(init.headers["X-Goog-Api-Key"]).toBe("KEY123");
    expect(JSON.parse(init.body)).toMatchObject({ textQuery: "dentist in Lahore, Pakistan", regionCode: "PK", pageSize: 20 });
  });
  it("reads places, drops ones without an id or name, and rejects unsafe links", () => {
    const r = parsePlaces({ nextPageToken: "T", places: [
      { id: "a", displayName: { text: "Smile Dental" }, websiteUri: "https://smile.example", rating: 4.46, userRatingCount: 12, internationalPhoneNumber: "+92 300 1234567" },
      { id: "b", displayName: { text: "Bad" }, websiteUri: "javascript:alert(1)", googleMapsUri: "data:text/html,x" },
      { displayName: { text: "No id" } }, { id: "c" },
    ] });
    expect(r.nextPageToken).toBe("T");
    expect(r.places.map((p) => p.placeId)).toEqual(["a", "b"]);
    expect(r.places[0]).toMatchObject({ rating: 4.5, ratingCount: 12 });
    expect(r.places[1].website).toBeNull();
    expect(r.places[1].mapsUrl).toBeNull();
    expect(httpUrl("ftp://x.test")).toBeNull();
  });
  it("turns Google errors into plain messages that never contain the key", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 403 }));
    await expect(searchText({ apiKey: "SECRETKEY", textQuery: "x", fetchImpl: f as never })).rejects.toThrow(/Places API \(New\)/);
    await expect(searchText({ apiKey: "SECRETKEY", textQuery: "x", fetchImpl: f as never })).rejects.not.toThrow(/SECRETKEY/);
    const t = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(searchText({ apiKey: "k", textQuery: "x", fetchImpl: t as never })).rejects.toBeInstanceOf(PlacesError);
  });
});
