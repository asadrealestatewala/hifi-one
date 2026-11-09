// In-memory fan-out for live team chat. Each open browser tab holds one event stream; publishing writes to every stream of the
// people named. Correct for a single server process, which is how Hifi One is deployed (see docs/MEETINGS.md for what changes
// with several instances). Nothing here is persisted: messages are saved in the database before they are published.
type Send = (event: string, data: unknown) => void;
const g = globalThis as unknown as { __chatHub?: Map<string, Set<Send>> };
const hub = () => (g.__chatHub ??= new Map<string, Set<Send>>());

export function subscribe(userId: string, send: Send): () => void {
  const set = hub().get(userId) ?? new Set<Send>();
  set.add(send);
  hub().set(userId, set);
  return () => {
    const s = hub().get(userId);
    s?.delete(send);
    if (s && s.size === 0) hub().delete(userId);
  };
}

export function publishTo(userIds: Iterable<string>, event: string, data: unknown): number {
  let n = 0;
  for (const id of new Set(userIds)) {
    const set = hub().get(id);
    if (!set) continue;
    for (const send of [...set]) {
      try { send(event, data); n++; } catch { set.delete(send); }
    }
  }
  return n;
}

export const isOnline = (userId: string) => (hub().get(userId)?.size ?? 0) > 0;
export const _reset = () => hub().clear();
