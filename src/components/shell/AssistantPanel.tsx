"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { loadAssistantChat, sendAssistantMessage, type ChatMessage } from "@/app/(app)/assistant/actions";
import Icon from "./Icon";

const LABEL: Record<string, string> = {
  receivables_summary: "money owed by clients", overdue_invoices: "overdue invoices", profit_this_month: "this month's profit", sales_pipeline: "the sales pipeline",
  project_status: "project status", my_open_tasks: "your open tasks", how_to_use_hifi_one: "the Hifi One guide", clients_overview: "clients", recent_payments: "recent payments",
  my_leave_requests: "your leave", my_attendance_recent: "your attendance",
};

// A screen path in an answer (for example /clients or /me/leave) becomes a link that opens that screen.
const PATH = /(^|[\s(])(\/[a-z][a-z0-9\-_]*(?:\/[a-z0-9\-_]+)*(?:\?[\w=&-]+)?)/g;
function Linked({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const parts: React.ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null;
  PATH.lastIndex = 0;
  while ((m = PATH.exec(text))) {
    parts.push(text.slice(last, m.index + m[1].length));
    parts.push(<Link key={m.index} href={m[2]} onClick={onNavigate} className="text-primary underline">{m[2]}</Link>);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

// The chat itself. `floating` is the small window opened from the Ask button; otherwise it fills the /assistant page.
export default function AssistantPanel({ floating, onClose }: { floating?: boolean; onClose?: () => void }) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(true);
  const [examples, setExamples] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadAssistantChat().then((s) => { if (!live) return; setChatId(s.chatId); setMessages(s.messages); setConnected(s.connected); setExamples(s.examples); setReady(true); }).catch(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);

  const send = useCallback((q: string) => {
    const question = q.trim();
    if (question.length < 3 || pending) return;
    setError(null); setText("");
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "USER", content: question, tools: [] }]);
    start(async () => {
      const r = await sendAssistantMessage(chatId, question);
      setChatId(r.chatId);
      if (r.ok && r.answer) setMessages((m) => [...m, r.answer!]);
      else { setError(r.error ?? "Something went wrong."); }
    });
  }, [chatId, pending]);

  const nav = () => { if (floating) onClose?.(); };
  return (
    <div className={floating ? "flex h-full flex-col" : "card flex h-[70vh] min-h-[420px] flex-col !p-0"}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 font-semibold"><Icon name="sparkles" className="h-4 w-4 text-primary" />Ask Hifi One</div>
        <div className="flex items-center gap-1">
          <button type="button" className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-black/5" onClick={() => { setChatId(null); setMessages([]); setError(null); }} disabled={messages.length === 0}>New chat</button>
          {floating && <button type="button" className="rounded-lg px-2 py-1 text-lg leading-none text-muted hover:bg-black/5" onClick={onClose} aria-label="Close chat">×</button>}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {!ready && <p className="text-sm text-muted">Loading…</p>}
        {ready && !connected && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700">Not connected. A super admin needs to add the Anthropic key in Settings → Integrations.</p>}
        {ready && messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm">Hi! Ask me how to do something in Hifi One, or about your numbers. I can only read what your role can open, and I cannot change anything.</p>
            <div className="flex flex-wrap gap-2">{examples.map((e) => <button key={e} type="button" className="rounded-full border border-border px-3 py-1 text-xs hover:bg-black/5" onClick={() => send(e)}>{e}</button>)}</div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "USER" ? "flex justify-end" : "flex justify-start"}>
            <div className={(m.role === "USER" ? "bg-primary text-white" : "bg-black/5 dark:bg-white/10") + " max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm"}>
              {m.role === "USER" ? m.content : <Linked text={m.content} onNavigate={nav} />}
              {m.role === "ASSISTANT" && m.tools.length > 0 && <p className="mt-1 text-[11px] text-muted">Based on: {m.tools.map((t) => LABEL[t] ?? t).join(", ")}</p>}
            </div>
          </div>
        ))}
        {pending && <div className="flex justify-start"><div className="rounded-2xl bg-black/5 px-3 py-2 text-sm text-muted dark:bg-white/10">Thinking…</div></div>}
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
        <div ref={end} />
      </div>
      <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea className="input !min-h-0 flex-1 resize-none" rows={1} maxLength={1000} value={text} placeholder="Type your question…" aria-label="Your question" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
        <button className="btn" disabled={pending || text.trim().length < 3}>Send</button>
      </form>
    </div>
  );
}
