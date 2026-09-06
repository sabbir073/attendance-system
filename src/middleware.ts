import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "desco_session";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

/**
 * Edge middleware performs a cheap presence check only. Real authorisation
 * (session validity, revocation, role) happens on the server in every page
 * and route handler — the cookie alone is never treated as proof.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/logo.svg" ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Authentication required." },
        { status: 401 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.svg).*)"],
};
