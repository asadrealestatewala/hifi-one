import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSend } from "@/lib/mailer";
import { myMailboxes, receivingConfig } from "@/lib/mailboxes";
import { paging } from "@/lib/paging";
import { Badge, Chips, Empty, NewButton, Notice, PageHeader, Pager, SearchBox } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = { box?: string; folder?: string; q?: string; page?: string; ok?: string; error?: string };
const FOLDERS = ["inbox", "sent", "archived"] as const;

// The signed-in person's own mailboxes only (membership is the permission). Administrators see nothing here they are not a member of.
export default async function MailInbox({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const boxes = await myMailboxes(db, user);
  const canManage = user.permissions.has("mail.manage");
  if (boxes.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Mailbox" />
        <Empty title="You do not have a mailbox yet">
          {canManage ? <>Create company and employee mailboxes in <Link className="underline" href="/settings/mailboxes">Settings › Mailboxes</Link>.</> : "Ask your administrator to create a mailbox for you or add you to a shared one."}
        </Empty>
      </div>
    );
  }
  const box = boxes.find((b) => b.id === sp.box) ?? null;
  const ids = box ? [box.id] : boxes.map((b) => b.id);
  const folder = (FOLDERS as readonly string[]).includes(sp.folder ?? "") ? (sp.folder as (typeof FOLDERS)[number]) : "inbox";
  const q = sp.q?.trim();
  const where = {
    mailboxId: { in: ids },
    ...(folder === "archived" ? { status: "ARCHIVED" } : { status: "OPEN" }),
    ...(folder === "inbox" ? { messages: { some: { direction: "IN" } } } : folder === "sent" ? { messages: { some: { direction: "OUT" } } } : {}),
    ...(q ? { OR: [{ subject: { contains: q, mode: "insensitive" as const } }, { counterpart: { contains: q, mode: "insensitive" as const } }, { snippet: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const pg = paging(sp.page);
  const [rows, total, unreadByBox] = await Promise.all([
    db.mailThread.findMany({ where, orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.mailThread.count({ where }),
    db.mailThread.groupBy({ by: ["mailboxId"], where: { mailboxId: { in: boxes.map((b) => b.id) }, status: "OPEN", unread: { gt: 0 } }, _count: true }),
  ]);
  const unread = new Map(unreadByBox.map((u) => [u.mailboxId, u._count]));
  const boxName = new Map(boxes.map((b) => [b.id, b.address]));
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter(Boolean) as string[])];
  const clients = new Map((await db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const cur: Record<string, string | undefined> = { box: box?.id, folder: folder === "inbox" ? undefined : folder, q };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/mail${t ? `?${t}` : ""}`; };
  const sendable = boxes.some((b) => b.members[0]?.canSend);
  const receiving = receivingConfig().configured;
  return (
    <div className="space-y-5">
      <PageHeader title="Mailbox" subtitle="Conversations in the mailboxes you have been given. Replies go out from the mailbox's own address."
        actions={sendable ? <NewButton href={`/mail/compose${box ? `?box=${box.id}` : ""}`}>Compose</NewButton> : undefined} />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {!canSend() && <Notice kind="error">Email is not connected yet, so nothing can be sent. An administrator sets it up under Settings › Email.</Notice>}
      {!receiving && <p className="text-xs text-muted">Receiving is not switched on yet: only messages sent from Hifi One appear here until an administrator connects incoming mail (Settings › Mailboxes).</p>}
      <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Mailboxes" className="card !p-2 h-fit">
          <ul className="space-y-0.5 text-sm">
            <li><Link href={href({ box: undefined, page: undefined })} className={`flex justify-between rounded-lg px-3 py-2 hover:bg-hover ${!box ? "bg-hover font-semibold" : ""}`}>All mailboxes</Link></li>
            {boxes.map((b) => (
              <li key={b.id}>
                <Link href={href({ box: b.id, page: undefined })} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-hover ${box?.id === b.id ? "bg-hover font-semibold" : ""}`}>
                  <span className="min-w-0"><span className="block truncate">{b.displayName}</span><span className="block truncate text-xs text-muted">{b.address}</span></span>
                  {(unread.get(b.id) ?? 0) > 0 && <Badge tone="primary">{unread.get(b.id)}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Chips current={folder} items={[{ key: "inbox", label: "Inbox", href: href({ folder: undefined, page: undefined }) }, { key: "sent", label: "Sent", href: href({ folder: "sent", page: undefined }) }, { key: "archived", label: "Archived", href: href({ folder: "archived", page: undefined }) }]} />
            <SearchBox q={q} placeholder="Search subject, address or text" hidden={{ ...cur, q: undefined }} />
          </div>
          {rows.length === 0 ? <Empty title={q ? "No conversations match" : folder === "inbox" ? "Nothing in the inbox" : folder === "sent" ? "Nothing sent yet" : "Nothing archived"}>{folder === "inbox" && !q ? "New emails to these addresses will appear here." : null}</Empty> : (
            <div className="card !p-0 overflow-hidden">
              <ul className="divide-y divide-border">
                {rows.map((t) => (
                  <li key={t.id}>
                    <Link href={`/mail/${t.id}`} className="flex gap-3 px-4 py-3 transition hover:bg-hover/50">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className={`truncate ${t.unread > 0 ? "font-semibold" : ""}`}>{t.counterpart}</span>
                          <span className="shrink-0 text-xs text-muted">{t.lastMessageAt.toLocaleString()}</span>
                        </span>
                        <span className={`block truncate text-sm ${t.unread > 0 ? "font-semibold" : ""}`}>{t.subject}</span>
                        <span className="block truncate text-xs text-muted">{t.snippet}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {!box && <Badge>{boxName.get(t.mailboxId)}</Badge>}
                          {t.clientId && <Badge tone="primary">Client: {clients.get(t.clientId) ?? "—"}</Badge>}
                          {t.employeeId && <Badge tone="warning">Staff</Badge>}
                          {t.unread > 0 && <Badge tone="success">{t.unread} new</Badge>}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pager page={pg.page} size={pg.size} total={total} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
