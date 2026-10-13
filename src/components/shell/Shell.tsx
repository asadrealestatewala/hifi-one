"use client";

import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import NavProgress from "./NavProgress";
import type { NavStats } from "@/lib/nav-stats";
import Link from "next/link";
import Icon from "./Icon";
import RowClick from "./RowClick";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

type Group = { id: string; title: string; icon: string; items: { href: string; label: string }[] };

// The signed-in frame: sidebar, top bar and the page. Only layout state lives here; every permission decision was made on the server.
export default function Shell({ groups, allGroups, menuPrefs, quick, name, roles, userId, unread, stats, canSearch, canAsk, signOut, children }: {
  groups: Group[]; allGroups: Group[]; menuPrefs: { order: string[]; hidden: string[] }; quick: { href: string; label: string; icon: string }[]; name: string; roles: string; userId: string; unread: number; stats: NavStats; canSearch: boolean; canAsk: boolean; signOut: () => Promise<void>; children: React.ReactNode;
}) {
  const [mobile, setMobile] = useState(false);
  const pathname = usePathname();
  return (
    <div className="min-h-screen md:flex">
      <Suspense fallback={null}><NavProgress /></Suspense>
      <Sidebar stats={stats} groups={groups} allGroups={allGroups} menuPrefs={menuPrefs} name={name} roles={roles} userId={userId} signOut={signOut} mobileOpen={mobile} onClose={() => setMobile(false)} />
      <div className="min-w-0 flex-1">
        <Topbar unread={unread} quick={quick} canSearch={canSearch} onMenu={() => setMobile(true)} />
        <main className="mx-auto w-full max-w-[1400px] p-4 md:p-8"><RowClick /><div key={pathname} className="[animation:fade_.25s_ease-out]">{children}</div></main>
        {canAsk && pathname !== "/assistant" && <Link href="/assistant" className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-primary-dark print:hidden" aria-label="Ask the assistant"><Icon name="sparkles" className="h-4 w-4" />Ask</Link>}
      </div>
    </div>
  );
}
