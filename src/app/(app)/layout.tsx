import { redirect } from "next/navigation";
import { logout, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import Shell from "@/components/shell/Shell";
import { NAV, QUICK_CREATE } from "@/components/shell/nav";

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The layout must not redirect (it would loop back to the password page); every page redirects on its own
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  const unread = await unreadCount(db, user.id);
  const groups = NAV.map((g) => ({ id: g.id, title: g.title, icon: g.icon, items: g.items.filter((i) => user.permissions.has(i.permission)).map((i) => ({ href: i.href, label: i.label })) })).filter((g) => g.items.length > 0);
  const quick = QUICK_CREATE.filter((q) => user.permissions.has(q.permission)).map(({ href, label, icon }) => ({ href, label, icon }));
  return (
    <Shell groups={groups} quick={quick} name={user.name} roles={user.roles.join(", ")} unread={unread} canSearch={user.permissions.has("dashboard.view")} signOut={signOut}>
      {children}
    </Shell>
  );
}
