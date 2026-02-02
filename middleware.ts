import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Public routes (no login required)
  const publicRoutes = [
    "/login",
    "/register",
    "/api/auth",
    "/api/templates",
    "/templates",
  ];

  // Internal service-to-service APIs (verified via INTERNAL_API_SECRET; bypass NextAuth)
  // These APIs are called by ai-server and do not require user login, but have their own secret verification.
  if (nextUrl.pathname.startsWith("/api/internal")) {
    return NextResponse.next();
  }

  // Check whether this is a public route
  const isPublicRoute = publicRoutes.some(route =>
    nextUrl.pathname.startsWith(route)
  ) || nextUrl.pathname === "/";

  // Static assets and most API routes are not protected
  if (
    nextUrl.pathname.startsWith("/_next") ||
    nextUrl.pathname.startsWith("/favicon") ||
    nextUrl.pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // If public route, allow
  if (isPublicRoute) {
    // If a logged-in user visits login/register, redirect to dashboard
    if (isLoggedIn && (nextUrl.pathname === "/login" || nextUrl.pathname === "/register")) {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }
    return NextResponse.next();
  }

  // If not logged in and visiting a protected page, redirect to login
  if (!isLoggedIn) {
    const callbackUrl = encodeURIComponent(nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${callbackUrl}`, nextUrl)
    );
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - api/auth (NextAuth API routes)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
