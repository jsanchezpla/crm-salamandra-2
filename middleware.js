import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/refresh", "/api/public/"];
const PUBLIC_PAGE_PATHS = ["/login"];

function isPublicPath(pathname) {
  return (
    PUBLIC_API_PATHS.some((p) => pathname.startsWith(p)) ||
    PUBLIC_PAGE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
  );
}

function isApiPath(pathname) {
  return pathname.startsWith("/api/");
}

export async function middleware(request) {
  const { pathname, method } = request.nextUrl;

  // Dejar pasar preflight CORS sin token
  if (request.method === "OPTIONS") {
    return NextResponse.next();
  }

  // Dejar pasar rutas públicas sin token
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("access_token")?.value;

  if (!token) {
    return isApiPath(pathname)
      ? NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const payload = await jwtVerify(token, ACCESS_SECRET);

    // Pasar datos del usuario a los Route Handlers via headers
    const headers = new Headers(request.headers);
    headers.set("x-user-id", payload.payload.userId);
    headers.set("x-user-role", payload.payload.role);
    headers.set("x-tenant", payload.payload.tenantSlug);

    return NextResponse.next({ request: { headers } });
  } catch {
    // Token inválido o expirado
    if (isApiPath(pathname)) {
      return NextResponse.json({ ok: false, error: "Token inválido o expirado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("expired", "1");
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
