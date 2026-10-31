// One parser for the address of every paged list: ?q=…&sort=…&dir=asc|desc&page=…, plus the list's own filters.
// Anything malformed falls back to the default instead of failing, so a hand-edited address never breaks a screen
// and can never pick a column or a status the list does not name.
import { z } from "zod";
import { paging, type Paging } from "./paging";
import { parseSort, type Sort } from "./sort";
import { parseRange, type DateRange } from "./date-range";

export type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

// Reads one value from either a URLSearchParams (route handlers) or a Next.js searchParams object (pages)
export function param(sp: RawParams, key: string): string | undefined {
  const v = sp instanceof URLSearchParams ? sp.get(key) ?? undefined : sp[key];
  return Array.isArray(v) ? v[0] : v;
}

const qSchema = z.string().trim().max(100).transform((s) => s || undefined);
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export type ListParams = {
  q?: string;
  page: Paging;
  sort: Sort;
  // True when the address chose the sort, so links only carry ?sort= when the person picked one
  sortChosen: boolean;
  status?: string;
  range: DateRange;
  ids: Record<string, string | undefined>;
};

export function parseListParams(sp: RawParams, opts: { sorts?: readonly string[]; defaultSort?: Sort; statuses?: readonly string[]; ids?: readonly string[] } = {}): ListParams {
  const fallback = opts.defaultSort ?? { key: "created", dir: "desc" as const };
  const sortRaw = param(sp, "sort");
  const sort = parseSort(sortRaw, param(sp, "dir"), opts.sorts ?? [], fallback);
  const q = qSchema.safeParse(param(sp, "q") ?? "");
  const status = param(sp, "status");
  const ids: Record<string, string | undefined> = {};
  for (const k of opts.ids ?? []) { const v = idSchema.safeParse(param(sp, k)); ids[k] = v.success ? v.data : undefined; }
  return {
    q: q.success ? q.data : undefined,
    page: paging(param(sp, "page")),
    sort,
    sortChosen: Boolean(sortRaw && sort.key === sortRaw),
    status: status && opts.statuses?.includes(status) ? status : undefined,
    range: parseRange(param(sp, "from"), param(sp, "to")),
    ids,
  };
}

// The address of a list with its current filters kept and `over` applied; empty values are dropped.
export function listHref(path: string, current: Record<string, string | undefined>, over: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v);
  const t = p.toString();
  return `${path}${t ? `?${t}` : ""}`;
}
