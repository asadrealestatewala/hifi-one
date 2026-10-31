import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { needsSetup } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { homeDestination } from "@/lib/home";
import { sitePage } from "./site/_lib/serve";

export const dynamic = "force-dynamic";

// "/" serves the company website to visitors and sends staff into the ERP (see src/lib/home.ts).
// A route handler rather than a page, so the website's HTML is returned as its own document outside the ERP layout.
export async function GET() {
  const destination = homeDestination({ setupNeeded: await needsSetup(db), signedIn: Boolean(await getSessionUser()) });
  if (destination !== "website") redirect(destination);
  // The answer depends on the visitor's cookie, so no browser or proxy may reuse it for someone else
  return sitePage("index", { "Cache-Control": "private, no-store", Vary: "Cookie" });
}
