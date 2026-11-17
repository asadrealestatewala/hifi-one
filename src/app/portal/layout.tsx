import PortalHeader from "@/components/portal/PortalHeader";
import PortalNav, { type PortalNavItem } from "@/components/portal/PortalNav";
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
  const cloutPosts = await db.cloutCampaign.count({ where: { clientId: user.clientId } });
  const agreements = await db.contract.count({ where: { clientId: user.clientId, sharedWithClient: true } });
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
  const approvals = await db.deliverable.count({ where: { status: "PENDING", projectId: { in: (await db.project.findMany({ where: { clientId: user.clientId }, select: { id: true } })).map((p) => p.id) } } });
  const items: PortalNavItem[] = [
    { href: "/portal", label: "Overview", icon: "home", tone: "violet" },
    { href: "/portal/projects", label: "Projects", icon: "briefcase", tone: "orange" },
    { href: "/portal/approvals", label: "Approvals", icon: "check", tone: "teal", count: approvals },
    { href: "/portal/content", label: "Content", icon: "calendar", tone: "pink", count: pending },
    { href: "/portal/brand", label: "Brand & media", icon: "palette", tone: "violet" },
    ...(cloutPosts > 0 ? [{ href: "/portal/clout", label: "Influencer posts", icon: "activity", tone: "pink" }] : []),
    ...(agreements > 0 ? [{ href: "/portal/agreements", label: "Agreements", icon: "file", tone: "violet" } as PortalNavItem] : []),
    { href: "/portal/quotes", label: "Proposals & quotations", icon: "file", tone: "slate", count: quotesOpen },
    { href: "/portal/statement", label: "Statement", icon: "receipt", tone: "green" },
    { href: "/portal/meetings", label: "Meetings", icon: "video", tone: "teal" },
    { href: "/portal/support", label: "Support", icon: "chat", tone: "blue" },
    { href: "/portal/notifications", label: "Updates", icon: "bell", tone: "amber", count: unread },
  ];
  return (
    <div className="min-h-screen">
      <PortalHeader title="Client portal" person={user.name} company={client?.name} signOut={signOut} />
      <PortalNav items={items} home="/portal" label="Client portal" />
      <main className="mx-auto max-w-5xl space-y-6 p-4 md:py-8">
        {children}
      </main>
    </div>
  );
}
