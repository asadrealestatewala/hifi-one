"use client";
// One live chat stream per browser tab, shared by the chat screen and the incoming-call ring.
// It opens when the first listener subscribes and closes when the last one leaves; a dropped connection is retried.
type Handler = (event: string, data: unknown) => void;
const EVENTS = ["hello", "message", "read", "deleted", "room", "call", "call-update"];
const handlers = new Set<Handler>();
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (source || handlers.size === 0) return;
  const es = new EventSource("/api/chat/events");
  source = es;
  for (const name of EVENTS) {
    es.addEventListener(name, (ev) => {
      let data: unknown = null;
      try { data = JSON.parse((ev as MessageEvent).data); } catch { return; }
      for (const h of [...handlers]) h(name, data);
    });
  }
  es.onerror = () => {
    for (const h of [...handlers]) h("_error", null);
    if (es.readyState === EventSource.CLOSED) {
      es.close(); source = null;
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 3000);
    }
  };
}

export function subscribeChat(h: Handler): () => void {
  handlers.add(h);
  connect();
  return () => {
    handlers.delete(h);
    if (handlers.size === 0) { source?.close(); source = null; if (retry) clearTimeout(retry); }
  };
}
