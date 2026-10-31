// Column sorting for lists. The sort lives in the address (?sort=name&dir=desc) so it can be shared and survives paging.
// Only fields a list names are accepted; anything else falls back to the list's default, so the address can never pick a column.
export type Sort = { key: string; dir: "asc" | "desc" };

export function parseSort(sortRaw: string | undefined, dirRaw: string | undefined, allowed: readonly string[], fallback: Sort): Sort {
  if (!sortRaw || !allowed.includes(sortRaw)) return fallback;
  return { key: sortRaw, dir: dirRaw === "desc" ? "desc" : "asc" };
}

// Prisma orderBy for a chosen column, with `id` as the final tiebreak so paging never repeats or skips a row.
// Nullable columns put empty values last in both directions.
export function orderFor(sort: Sort, columns: Record<string, { field: string; nullable?: boolean }>) {
  const col = columns[sort.key];
  if (!col) return [{ id: "asc" as const }];
  const dir = col.nullable ? { sort: sort.dir, nulls: "last" as const } : sort.dir;
  return [{ [col.field]: dir }, { id: sort.dir }];
}
