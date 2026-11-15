import PortalHeader from "@/components/portal/PortalHeader";
import PortalNav, { type PortalNavItem } from "@/components/portal/PortalNav";
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
  const items: PortalNavItem[] = [
    { href: "/vendor", label: "Opportunities", icon: "target", tone: "violet" },
    { href: "/vendor/work", label: "Work & bills", icon: "briefcase", tone: "orange" },
    { href: "/vendor/ledger", label: "Statement", icon: "receipt", tone: "green" },
    { href: "/vendor/documents", label: "Documents", icon: "file", tone: "amber" },
    { href: "/vendor/profile", label: "Profile", icon: "building", tone: "blue" },
    { href: "/vendor/notifications", label: "Updates", icon: "bell", tone: "amber", count: unread },
  ];
  return (
    <div className="min-h-screen">
      <PortalHeader title="Vendor portal" person={user.name} company={vendor?.name} note={vendor?.status !== "APPROVED" ? " (approval pending)" : ""} signOut={signOut} />
      <PortalNav items={items} home="/vendor" label="Vendor portal" />
      <main className="mx-auto max-w-5xl space-y-6 p-4 md:py-8">
        {children}
      </main>
    </div>
  );
}
