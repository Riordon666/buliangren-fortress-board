import { NextRequest, NextResponse } from "next/server";
import { FORCE_PASSWORD_COOKIE } from "@/lib/constants";

export function proxy(request: NextRequest) {
  const mustChange = request.cookies.get(FORCE_PASSWORD_COOKIE)?.value === "1";
  if (mustChange && (request.nextUrl.pathname.startsWith("/scores") || request.nextUrl.pathname.startsWith("/admin"))) {
    return NextResponse.redirect(new URL("/profile?required=1", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/scores/:path*", "/admin/:path*"]
};
