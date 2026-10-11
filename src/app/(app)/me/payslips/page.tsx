import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function MyPayslips() {
  const user = await requirePermission("self.payslip");
  // Only your own lines, and only once the run has been approved
  const items = await db.payrollItem.findMany({
    where: { userId: user.id, run: { status: { in: ["APPROVED", "POSTED", "PAID"] } } },
    include: { run: true },
    orderBy: { run: { period: "desc" } },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My Payslips</h1>
      <div className="card">
        {items.length === 0 ? <p className="text-sm text-muted">No payslips yet.</p> : (
          <ul className="text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between border-t border-border py-2 first:border-0">
                <Link className="underline" href={`/payslips/${i.id}`}>{i.run.period}</Link>
                <span>{formatMoney(i.net, i.run.currency)} net · {i.run.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
