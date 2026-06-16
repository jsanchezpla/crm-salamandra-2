import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Rutas que NO requieren JWT en cookie. Cuidado al añadir entradas: el matcher
// usa `pathname.startsWith(p)`, así que `/api/leads` cubriría toda la API
// privada del módulo. La forma pública correcta vive bajo `/api/public/`.
const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/public/",
  "/api/cursos-empresas/",
  "/api/webhooks/",
  "/api/register",
  "/api/usuarios/register/",
  "/api/external/",
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

// Rutas de la landing pública embebibles vía iframe. Necesitan
// `frame-ancestors *` para que cualquier dominio pueda incrustarlas. En
// Sprint 2 (cuando el dominio de Laura esté confirmado) se restringirá a
// `frame-ancestors https://tunutrilaura.com https://www.tunutrilaura.com`.
function isEmbeddableWidgetPath(pathname) {
  return pathname.startsWith("/widget/c/");
}

function applyWidgetCspHeaders(response) {
  response.headers.set("Content-Security-Policy", "frame-ancestors *");
  // X-Frame-Options legacy: eliminar para no bloquear el iframe. NextResponse
  // no lo añade por defecto, pero lo borramos por si algún proxy lo inyecta.
  response.headers.delete("X-Frame-Options");
  return response;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Dejar pasar todos los preflights CORS — los Route Handlers añaden sus propios headers
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  // Landing pública del módulo Citas — pública + embebible
  if (isEmbeddableWidgetPath(pathname)) {
    return applyWidgetCspHeaders(NextResponse.next());
  }

  // Dejar pasar rutas públicas sin token, con CORS headers en la respuesta.
  // El OPTIONS preflight de más arriba ya devuelve CORS_HEADERS, pero la
  // respuesta del método real (POST/GET) también necesita
  // Access-Control-Allow-Origin para que el browser permita al JS leer
  // body. Sin esto, un fetch cross-origin desde asesoriaretorika.com
  // al endpoint /registro-curso fallaba con "Failed to fetch" aunque
  // el servidor sí procesara la request.
  if (isPublicPath(pathname)) {
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.headers.set(k, v);
    }
    return res;
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
    // x-user-email: usado por endpoints que registran autoría (notes,
    // attachments, etc.). El JWT lo lleva en payload.email desde el login.
    if (payload.payload.email) {
      headers.set("x-user-email", payload.payload.email);
    }

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
