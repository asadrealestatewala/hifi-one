import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout, requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";

async function signOut() {
  "use server";
  await logout();
  redirect("/login?for=partner");
}

// The Hifi Partner Stack portal. Everything in it is read for the one earner bound to the signed-in partner.
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const { earner } = await requirePartnerUser();
  const resale = (await db.partnerResaleTerm.count({ where: { earnerId: earner.id, model: "RESALE" } })) > 0;
  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto max-w-5xl flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" />
            <span className="font-bold">Hifi Partner Stack</span>
          </div>
          <nav aria-label="Partner portal" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm [&>a]:whitespace-nowrap">
            <Link href="/partner" className="hover:underline">Overview</Link>
            <Link href="/partner/academy" className="hover:underline">Academy</Link>
            {resale && <Link href="/partner/schools" className="hover:underline">My schools</Link>}
            {(resale || earner.billingClientId) && <Link href="/partner/invoices" className="hover:underline">Invoices</Link>}
            <Link href="/partner/details" className="hover:underline">My details</Link>
            <span className="text-white/70">{earner.name}</span>
            <form action={signOut}><button className="underline">Sign out</button></form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">{children}</main>
    </div>
  );
}
