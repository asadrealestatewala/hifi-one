import { redirect } from "next/navigation";
import { logout, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import { totalUnread } from "@/lib/chat";
import { loadNavStats } from "@/lib/nav-stats";
import Shell from "@/components/shell/Shell";
import { QUICK_CREATE, visibleNav } from "@/components/shell/nav";
import { startViewAs, stopViewAs } from "./view-as/actions";
import { canPreviewRole } from "@/lib/view-as";
import { applyMenu, sanitizeMenu } from "@/lib/menu-layout";

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The layout must not redirect (it would loop back to the password page); every page redirects on its own
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  // While previewing a role the Super Admin's own saved menu arrangement is not applied (it is built for their full menu) and is left untouched
  const [unread, chatUnread, stats, saved, switchRoles] = await Promise.all([
    unreadCount(db, user.id), user.permissions.has("chat.use") && user.userType === "EMPLOYEE" ? totalUnread(db, user.id) : null, loadNavStats(user.organizationId, user.id, user.permissions),
    user.viewAs ? null : db.userPreference.findUnique({ where: { userId_key: { userId: user.id, key: "menu" } } }),
    user.realSuperAdmin ? db.role.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" }, select: { key: true, name: true } }) : null,
  ]);
  const allGroups = visibleNav(user.permissions);
  const prefs = sanitizeMenu(saved?.value, allGroups);
  const groups = applyMenu(allGroups, prefs);
  const quick = QUICK_CREATE.filter((q) => user.permissions.has(q.permission)).map(({ href, label, icon }) => ({ href, label, icon }));
  return (
    <Shell groups={groups} allGroups={allGroups} menuPrefs={prefs} quick={quick} name={user.name} roles={user.roles.join(", ")} userId={user.id} unread={unread} chatUnread={chatUnread} stats={stats} canSearch={user.permissions.has("dashboard.view")} canAsk={user.permissions.has("assistant.use")} signOut={signOut}
      viewAs={switchRoles ? { roles: switchRoles.filter((r) => canPreviewRole(r.key)), active: user.viewAs ? { key: user.viewAs.roleKey, name: user.viewAs.roleName } : null, start: startViewAs, stop: stopViewAs } : null}>
      {children}
    </Shell>
  );
}
