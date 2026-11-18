import { NextResponse, type NextRequest } from "next/server";
import { VIEW_AS_USER_COOKIE, READ_METHODS, isClosedWhileViewing, isEndViewRequest } from "@/lib/view-as";

// While a Super Admin looks at one person's view (cookie present) nothing may change: every request that is not a plain read is refused
// (this covers server actions, forms and API routes alike), and the pages with passwords, two-step set-up and private chats stay closed.
export function middleware(req: NextRequest) {
  if (!req.cookies.get(VIEW_AS_USER_COOKIE)) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (isEndViewRequest(pathname)) return NextResponse.next();
  if (!READ_METHODS.has(req.method)) {
    return NextResponse.json({ error: "You are looking at someone else's view. It is read-only, so nothing was changed. End the view to make changes." }, { status: 403 });
  }
  if (isClosedWhileViewing(pathname)) {
    return NextResponse.json({ error: "This screen is closed while you look at someone else's view." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
