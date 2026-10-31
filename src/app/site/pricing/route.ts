import { sitePage } from "../_lib/serve";

export const dynamic = "force-static";

export function GET() {
  return sitePage("pricing");
}
