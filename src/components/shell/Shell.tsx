"use client";

import { usePathname } from "next/navigation";
import CallListener from "./CallListener";
import { Suspense, useState } from "react";
import NavProgress from "./NavProgress";
import type { NavStats } from "@/lib/nav-stats";
import type { MenuPrefs } from "@/lib/menu-layout";
import Link from "next/link";
import CommandPalette from "./CommandPalette";
import Icon from "./Icon";
import RowClick from "./RowClick";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import WorkfolioDock from "./WorkfolioDock";
import CircularPopup from "./CircularPopup";
import ViewAsBanner from "./ViewAsBanner";
import ViewAsMenu from "./ViewAsMenu";

type ViewAs = { roles: { key: string; name: string }[]; active: { key: string; name: string } | null; start: (key: string) => Promise<{ error?: string }>; stop: () => Promise<{ error?: string }> };

type Group = { id: string; title: string; icon: string; items: { href: string; label: string }[] };

// The signed-in frame: sidebar, top bar and the page. Only layout state lives here; every permission decision was made on the server.
export default function Shell({ groups, allGroups, menuPrefs, quick, name, roles, userId, unread, chatUnread, stats, canSearch, canAsk, callerId, signOut, viewAs, children }: {
  groups: Group[]; allGroups: Group[]; menuPrefs: MenuPrefs; quick: { href: string; label: string; icon: string }[]; name: string; roles: string; userId: string; unread: number; chatUnread: number | null; stats: NavStats; canSearch: boolean; canAsk: boolean; callerId: string | null; signOut: () => Promise<void>; viewAs: ViewAs | null; children: React.ReactNode;
}) {
  const [mobile, setMobile] = useState(false);
  const pathname = usePathname();
  return (
    <div className="min-h-screen md:flex">
      <Suspense fallback={null}><NavProgress /></Suspense>
      <CommandPalette groups={allGroups} quick={quick} canSearch={canSearch} />
      <Sidebar stats={stats} groups={groups} allGroups={allGroups} menuPrefs={menuPrefs} name={name} roles={roles} userId={userId} signOut={signOut} mobileOpen={mobile} onClose={() => setMobile(false)} />
      <div className="min-w-0 flex-1">
        {viewAs?.active && <ViewAsBanner roleName={viewAs.active.name} stop={viewAs.stop} />}
        <Topbar unread={unread} chatUnread={chatUnread} quick={quick} canSearch={canSearch} onMenu={() => setMobile(true)} extra={viewAs ? <ViewAsMenu roles={viewAs.roles} active={viewAs.active?.key ?? null} start={viewAs.start} /> : null} />
        <WorkfolioDock />
        <CircularPopup />
        {callerId && <CallListener meId={callerId} />}
        <main className="mx-auto w-full max-w-[1400px] p-4 md:p-8"><RowClick /><div key={pathname} className="[animation:fade_.25s_ease-out]">{children}</div></main>
        {canAsk && pathname !== "/assistant" && !pathname.startsWith("/chat") && <Link href="/assistant" className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-primary-dark print:hidden" aria-label="Ask the assistant"><Icon name="sparkles" className="h-4 w-4" />Ask</Link>}
      </div>
    </div>
  );
}
