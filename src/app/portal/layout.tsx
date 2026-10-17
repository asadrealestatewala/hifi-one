import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireClientUser();
  const client = await db.client.findUnique({ where: { id: user.clientId }, select: { name: true } });
  const pending = await db.contentItem.count({ where: { clientId: user.clientId, status: "CLIENT_REVIEW" } });
  const quotesOpen = await db.quote.count({ where: { clientId: user.clientId, status: "SENT" } });
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
  const approvals = await db.deliverable.count({ where: { status: "PENDING", projectId: { in: (await db.project.findMany({ where: { clientId: user.clientId }, select: { id: true } })).map((p) => p.id) } } });
  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto max-w-5xl flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Hifi One" width={32} height={32} className="rounded-md" />
            <span className="font-bold">Hifi Marketing and Technologies</span>
          </div>
          <nav aria-label="Portal" className="flex items-center gap-4 text-sm">
            <Link href="/portal" className="hover:underline">Overview</Link>
            <Link href="/portal/projects" className="hover:underline">Projects</Link>
            <Link href="/portal/approvals" className="hover:underline">Approvals{approvals > 0 && ` (${approvals})`}</Link>
            <Link href="/portal/support" className="hover:underline">Support</Link>
            <Link href="/portal/content" className="hover:underline">Content{pending > 0 && ` (${pending})`}</Link>
            <Link href="/portal/quotes" className="hover:underline">Quotations{quotesOpen > 0 && ` (${quotesOpen})`}</Link>
            <Link href="/portal/meetings" className="hover:underline">Meetings</Link>
            <Link href="/portal/notifications" className="hover:underline">Updates{unread > 0 && ` (${unread})`}</Link>
            <Link href="/portal/statement" className="hover:underline">Statement</Link>
            <form action={signOut}><button className="underline">Sign out</button></form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 space-y-6">
        <p className="text-sm text-muted">Signed in as {user.name}, {client?.name}</p>
        {children}
      </main>
    </div>
  );
}
