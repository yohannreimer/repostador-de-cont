import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getAuthConfig } from "./lib/auth";

const PUBLIC_PATHS = ["/login", "/auth/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    const hasSession = request.cookies.get(AUTH_COOKIE_NAME)?.value === getAuthConfig().sessionToken;
    if (hasSession && pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const isAuthenticated = cookieValue === getAuthConfig().sessionToken;

  if (!isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    const next = pathname === "/" ? "/" : `${pathname}${search}`;
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};

