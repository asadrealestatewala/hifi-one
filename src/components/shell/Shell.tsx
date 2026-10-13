"use client";

import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import NavProgress from "./NavProgress";
import type { NavStats } from "@/lib/nav-stats";
import RowClick from "./RowClick";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

type Group = { id: string; title: string; icon: string; items: { href: string; label: string }[] };

// The signed-in frame: sidebar, top bar and the page. Only layout state lives here; every permission decision was made on the server.
export default function Shell({ groups, quick, name, roles, unread, stats, canSearch, signOut, children }: {
  groups: Group[]; quick: { href: string; label: string; icon: string }[]; name: string; roles: string; unread: number; stats: NavStats; canSearch: boolean; signOut: () => Promise<void>; children: React.ReactNode;
}) {
  const [mobile, setMobile] = useState(false);
  const pathname = usePathname();
  return (
    <div className="min-h-screen md:flex">
      <Suspense fallback={null}><NavProgress /></Suspense>
      <Sidebar stats={stats} groups={groups} mobileOpen={mobile} onClose={() => setMobile(false)} />
      <div className="min-w-0 flex-1">
        <Topbar name={name} roles={roles} unread={unread} quick={quick} canSearch={canSearch} signOut={signOut} onMenu={() => setMobile(true)} />
        <main className="mx-auto w-full max-w-[1400px] p-4 md:p-8"><RowClick /><div key={pathname} className="[animation:fade_.25s_ease-out]">{children}</div></main>
      </div>
    </div>
  );
}
