import Image from "next/image";
import Avatar from "@/components/ui/Avatar";
import Icon from "@/components/shell/Icon";

// Top band of the client and vendor portals: Hifi logo and portal name, then who is signed in for which company, and sign out.
export default function PortalHeader({ title, person, company, note, signOut }: { title: string; person: string; company?: string | null; note?: string; signOut: () => Promise<void> }) {
  return (
    <header className="bg-navy text-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/logo.png" alt="Hifi One" width={32} height={32} className="rounded-md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight sm:text-base">Hifi Marketing and Technologies</p>
            <p className="text-xs text-white/60">{title}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <Avatar name={person} size={30} />
            <div className="text-right leading-tight">
              <p className="text-sm font-medium">{person}</p>
              {company && <p className="text-xs text-white/60">{company}{note}</p>}
            </div>
          </div>
          <form action={signOut}>
            <button className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"><Icon name="logout" className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Sign out</span></button>
          </form>
        </div>
      </div>
    </header>
  );
}
