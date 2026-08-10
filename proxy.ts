import { NextRequest, NextResponse } from "next/server";
import { FORCE_PASSWORD_COOKIE } from "@/lib/constants";

export function proxy(request: NextRequest) {
  const mustChange = request.cookies.get(FORCE_PASSWORD_COOKIE)?.value === "1";
  const protectedPages = ["/home", "/scores", "/packages", "/reports", "/compare", "/admin"];
  if (mustChange && protectedPages.some((pathname) => request.nextUrl.pathname.startsWith(pathname))) {
    return NextResponse.redirect(new URL("/profile?required=1", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/home/:path*", "/scores/:path*", "/packages/:path*", "/reports/:path*", "/compare/:path*", "/admin/:path*"]
};
