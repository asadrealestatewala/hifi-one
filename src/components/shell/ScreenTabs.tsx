import { requireUser } from "@/lib/auth";
import { Chips } from "@/components/ui";
import { groupTabs } from "./screen-groups";

// The tab row for a screen group (see screen-groups.ts). Rendered under the page header, so the person moves
// between the screens of one subject without going back to the menu. Each tab is still its own guarded page.
// Only tabs the person may open are shown, and a person who may see only one gets no tab row at all.
export default async function ScreenTabs({ group, current }: { group: string; current: string }) {
  const user = await requireUser();
  const tabs = groupTabs(group, user.permissions);
  if (tabs.length < 2) return null;
  return <Chips current={current} items={tabs.map((t) => ({ key: t.href, label: t.label, href: t.href }))} />;
}
