// In-memory fan-out for live meeting events (signalling, chat, roster). Each connected browser holds one open event stream;
// publishing writes to the right streams. This is correct for a single server process, which is how Hifi One is deployed
// (see docs/MEETINGS.md for what changes if you run several instances). Nothing here is persisted: chat is stored separately.
type Send = (event: string, data: unknown) => void;
type Hub = Map<string, Map<string, Send>>;
const g = globalThis as unknown as { __meetingHub?: Hub };
const hub = (): Hub => (g.__meetingHub ??= new Map());

export function subscribe(meetingId: string, participantId: string, send: Send): () => void {
  const room = hub().get(meetingId) ?? new Map<string, Send>();
  room.set(participantId, send);
  hub().set(meetingId, room);
  return () => {
    const r = hub().get(meetingId);
    if (r?.get(participantId) === send) r.delete(participantId); // a newer connection by the same person is left alone
    if (r && r.size === 0) hub().delete(meetingId);
  };
}

export function publish(meetingId: string, event: string, data: unknown, opts: { to?: string; only?: string[]; except?: string } = {}) {
  const room = hub().get(meetingId);
  if (!room) return 0;
  let n = 0;
  for (const [id, send] of room) {
    if (opts.to && id !== opts.to) continue;
    if (opts.only && !opts.only.includes(id)) continue;
    if (opts.except && id === opts.except) continue;
    try { send(event, data); n++; } catch { room.delete(id); }
  }
  return n;
}

export const online = (meetingId: string): string[] => [...(hub().get(meetingId)?.keys() ?? [])];
export const isOnline = (meetingId: string, participantId: string) => hub().get(meetingId)?.has(participantId) ?? false;
export const _reset = () => hub().clear();
