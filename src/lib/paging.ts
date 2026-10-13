// Server-side paging for list screens. The page number lives in the address (?page=2) so a view can be
// shared; lists never silently stop at a fixed number of rows.
export const PAGE_SIZE = 50;

export type Paging = { page: number; size: number; skip: number; take: number };

export function paging(raw: string | undefined, size = PAGE_SIZE): Paging {
  const n = Number.parseInt(raw ?? "", 10);
  const page = Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : 1;
  return { page, size, skip: (page - 1) * size, take: size };
}

// "51–100 of 230" style range for a page of a list with `total` rows.
export function pageRange(p: Pick<Paging, "page" | "size">, total: number): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / p.size));
  if (total === 0) return { from: 0, to: 0, pages };
  const from = Math.min((p.page - 1) * p.size + 1, total);
  return { from, to: Math.min(p.page * p.size, total), pages };
}
