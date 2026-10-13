import { redirect } from "next/navigation";
import { logout, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { loadNavStats } from "@/lib/nav-stats";
import Shell from "@/components/shell/Shell";
import { QUICK_CREATE, visibleNav } from "@/components/shell/nav";
import { applyMenu, sanitizeMenu } from "@/lib/menu-layout";

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The layout must not redirect (it would loop back to the password page); every page redirects on its own
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  const [unread, stats, saved] = await Promise.all([unreadCount(db, user.id), loadNavStats(user.organizationId, user.id, user.permissions), db.userPreference.findUnique({ where: { userId_key: { userId: user.id, key: "menu" } } })]);
  const allGroups = visibleNav(user.permissions);
  const prefs = sanitizeMenu(saved?.value, allGroups);
  const groups = applyMenu(allGroups, prefs);
  const quick = QUICK_CREATE.filter((q) => user.permissions.has(q.permission)).map(({ href, label, icon }) => ({ href, label, icon }));
  return (
    <Shell groups={groups} allGroups={allGroups} menuPrefs={prefs} quick={quick} name={user.name} roles={user.roles.join(", ")} userId={user.id} unread={unread} stats={stats} canSearch={user.permissions.has("dashboard.view")} canAsk={user.permissions.has("assistant.use")} signOut={signOut}>
      {children}
    </Shell>
  );
}
