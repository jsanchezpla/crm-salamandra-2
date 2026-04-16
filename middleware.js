import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/public/",
  "/api/cursos-empresas/",
  "/api/webhooks/",
];
const PUBLIC_PAGE_PATHS = ["/login"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-tenant",
};

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
  const { pathname } = request.nextUrl;

  // Responder preflight CORS directamente desde el middleware
  if (request.method === "OPTIONS" && pathname.startsWith("/api/public/")) {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
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
