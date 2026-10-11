import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/bootstrap";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  // A brand-new installation has no users yet: send the visitor to first-run setup
  redirect((await needsSetup(db)) ? "/setup" : "/dashboard");
}
