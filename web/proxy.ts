import { NextResponse, type NextRequest } from "next/server";

/**
 * Phones and Android tablets go straight to the kiosk.
 *
 * This is `proxy.ts`, not `middleware.ts` — that filename and its named
 * export are both deprecated as of Next 16.
 *
 * iPads are deliberately NOT handled here. Since iPadOS 13, mobile Safari
 * reports itself as "Macintosh" — indistinguishable from a real Mac by
 * user-agent alone. That case is caught on the client in app/page.tsx using
 * maxTouchPoints, which is the only reliable signal. Doing the obvious cases
 * here keeps them free of any client-side flash.
 */
const MOBILE = /Android|iPhone|iPod|Windows Phone|BlackBerry|Silk|Kindle/i;

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname !== "/") return NextResponse.next();

  // An explicit choice always wins over detection.
  if (req.nextUrl.searchParams.has("choose")) return NextResponse.next();

  if (MOBILE.test(req.headers.get("user-agent") ?? "")) {
    return NextResponse.redirect(new URL("/kiosk", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/" };
