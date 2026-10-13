import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout, requireVendorUser } from "@/lib/auth";
import { db } from "@/lib/db";

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireVendorUser();
  const vendor = await db.vendor.findUnique({ where: { id: user.vendorId }, select: { name: true, status: true } });
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto max-w-5xl flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Hifi One" width={32} height={32} className="rounded-md" />
            <span className="font-bold">Hifi Marketing and Technologies · Vendor portal</span>
          </div>
          <nav aria-label="Vendor portal" className="flex items-center gap-4 text-sm">
            <Link href="/vendor" className="hover:underline">Opportunities</Link>
            <Link href="/vendor/work" className="hover:underline">Work & bills</Link>
            <Link href="/vendor/ledger" className="hover:underline">Statement</Link>
            <Link href="/vendor/profile" className="hover:underline">Profile</Link>
            <Link href="/vendor/notifications" className="hover:underline">Updates{unread > 0 && ` (${unread})`}</Link>
            <form action={signOut}><button className="underline">Sign out</button></form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 space-y-6">
        <p className="text-sm text-muted">Signed in as {user.name}, {vendor?.name}{vendor?.status !== "APPROVED" && " (approval pending)"}</p>
        {children}
      </main>
    </div>
  );
}
