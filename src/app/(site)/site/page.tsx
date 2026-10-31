import type { Metadata } from "next";
import { Home, HOME_TITLE } from "../_components/Home";

// The same home page at a fixed address, so staff who are signed in can still open the website. "/" is the canonical copy.
export const metadata: Metadata = { title: { absolute: HOME_TITLE }, alternates: { canonical: "/" } };

export default function Page() {
  return <Home />;
}
