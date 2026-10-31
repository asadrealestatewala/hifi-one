import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { needsSetup } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { homeDestination } from "@/lib/home";
import { Home, HOME_TITLE } from "./_components/Home";

// "/" shows visitors the company website and sends staff into the ERP (rule in src/lib/home.ts). The answer depends on the
// visitor's session, so the page is rendered per request and never cached for someone else.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: HOME_TITLE }, alternates: { canonical: "/" } };

export default async function Page() {
  const destination = homeDestination({ setupNeeded: await needsSetup(db), signedIn: Boolean(await getSessionUser()) });
  if (destination !== "website") redirect(destination);
  return <Home />;
}
