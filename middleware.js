import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Rutas que NO requieren JWT en cookie. Cuidado al añadir entradas: el matcher
// usa `pathname.startsWith(p)`, así que `/api/leads` cubriría toda la API
// privada del módulo. La forma pública correcta vive bajo `/api/public/`.
const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/demo", // demo pública: el visitante aún no tiene cookie
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

// Rutas de la landing pública embebibles vía iframe.
function isEmbeddableWidgetPath(pathname) {
  return pathname.startsWith("/widget/c/");
}

/**
 * Slug del tenant a partir de /widget/c/{slug}/...
 *
 * Se DECODIFICA antes de comparar (arreglado 2026-07-28): Next decodifica el
 * segmento dinámico antes de dárselo a la página, así que pidiendo
 * /widget/c/nutri%5Flaura el widget se servía igual mientras el regex del
 * pathname crudo no casaba y este candado se caía a `*`. Percent-codificar una
 * letra era todo lo que hacía falta para saltárselo.
 */
function slugDeWidget(pathname) {
  const partes = pathname.split("/").filter(Boolean); // ["widget","c","slug",...]
  if (!partes[2]) return null;
  let crudo = partes[2];
  try {
    crudo = decodeURIComponent(crudo);
  } catch {
    return null; // codificación inválida: no es el slug de nadie
  }
  return /^[a-z0-9_]+$/.test(crudo) ? crudo : null;
}

/**
 * Dominios que pueden incrustar el widget de cada tenant.
 *
 * Se configura con la variable de entorno WIDGET_FRAME_ANCESTORS, un JSON
 * { slug: "https://dominio.com https://www.dominio.com" }. El middleware corre
 * antes que la BD (no puede consultar Sequelize), por eso va en el entorno.
 *
 * Un tenant SIN entrada sigue con `*` (comportamiento de siempre): así activar
 * esto no rompe a nadie, y se va cerrando cliente a cliente según confirman su
 * dominio. Cerrado = un tercero no puede incrustar la reserva de citas del
 * cliente en su web y hacerse pasar por él ante sus pacientes.
 */
function frameAncestorsDe(slug) {
  if (!slug) return "*";
  try {
    const mapa = JSON.parse(process.env.WIDGET_FRAME_ANCESTORS || "{}");
    const permitidos = mapa[slug];
    if (typeof permitidos === "string" && permitidos.trim()) {
      // 'self' siempre: si no, el propio CRM no podría previsualizarlo.
      return `'self' ${permitidos.trim()}`;
    }
  } catch {
    /* JSON mal formado: no romper el widget por un error de configuración */
  }
  return "*";
}

function applyWidgetCspHeaders(response, pathname) {
  const ancestros = frameAncestorsDe(slugDeWidget(pathname));
  response.headers.set("Content-Security-Policy", `frame-ancestors ${ancestros}`);
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
    return applyWidgetCspHeaders(NextResponse.next(), pathname);
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
    if (isApiPath(pathname)) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    // `next` para devolver al usuario a la pantalla donde estaba tras entrar.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
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
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
