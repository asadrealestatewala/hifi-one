// Shown on every page, in every portal, while a Super Admin looks at one person's view. A plain form (no script needed) ends the view.
export default function ViewAsPersonBanner({ name, adminName, typeLabel }: { name: string; adminName: string; typeLabel: string }) {
  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-500 px-4 py-2 text-sm font-medium text-black print:hidden">
      <span>Viewing as <strong>{name}</strong> ({typeLabel}), read-only. You are signed in as {adminName}; nothing you do here changes data, and this view is recorded in the audit log.</span>
      <form action="/view-as/stop" method="post">
        <button type="submit" className="rounded-md bg-black px-3 py-1 text-xs font-semibold text-white hover:bg-black/80">End view</button>
      </form>
    </div>
  );
}
