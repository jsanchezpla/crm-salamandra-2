import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { esPeticionDeBackoffice } from "./lib/auth/backoffice.js";

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

// ─── Separación por HOST: back-office interno vs CRM de clientes ─────────────
//
// `ADMIN_HOST` (p. ej. "admin.salamandrasolutions.com"; en local
// "admin.localhost:3000"). Sin la variable, todo se comporta como siempre.
//
// Esto REDUCE SUPERFICIE, no autoriza. Quien de verdad decide si alguien puede
// dar de alta un cliente sigue siendo el endpoint, con su `hasModule` y su rol
// leído fresco de BD. Un 404 por host no sustituye a eso: sirve para que el
// subdominio interno no exponga además toda la superficie anónima del CRM.
const ADMIN_HOST = (process.env.ADMIN_HOST || "").toLowerCase().trim();

// En el back-office no pinta nada la superficie ANÓNIMA del producto: widgets
// embebibles, portal del paciente, webhooks de terceros, altas públicas y —muy
// especialmente— /api/auth/demo, que firma un token de admin a un visitante sin
// credenciales.
/**
 * LO ÚNICO que existe en el host del back-office. Es una lista blanca, no negra.
 *
 * ── POR QUÉ SE CAMBIÓ DE PLANTEAMIENTO (2026-08-01) ──────────────────────────
 * Antes solo se QUITABA de este host la superficie anónima (widgets, portal,
 * webhooks, demo), y con eso se daba por hecho que quedaba "el back-office".
 * No: quedaba el CRM ENTERO. Al entrar por la raíz del subdominio con la cuenta
 * del panel, lo que salía era el escritorio de Salamandra —sus clientes, su
 * facturación, su captación—, que es exactamente lo que esta cuenta no debería
 * poder ni ver.
 *
 * Una lista negra en una frontera es una promesa de acordarse de todo lo que
 * venga después. Aquí la respuesta correcta es la contraria: este host sirve el
 * panel y lo imprescindible para entrar en él, y todo lo demás no existe.
 *
 * Las tres primeras son lo que llaman de verdad sus dos pantallas; el resto es
 * poder identificarse y que carguen los recursos de Next.
 */
const SOLO_ESTO_EN_BACKOFFICE = [
  "/admin",
  "/api/admin",
  "/api/provisioning",
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/refresh",
  "/_next/",
];

// Y al revés: lo que se construya para Salamandra no se sirve desde el host que
// usan los clientes. Hoy no existen estas rutas; la regla se deja puesta para
// que el día que existan nazcan ya cerradas.
// `/api/provisioning` va aquí desde el 2026-08-01: es el endpoint que CREA
// clientes enteros (schema, módulos, admin, marca). Estaba fuera de la lista, o
// sea que se podía llamar desde el host del CRM — la pantalla vive en el
// back-office, pero la puerta estaba en los dos sitios.
const SOLO_BACKOFFICE = ["/admin", "/api/admin", "/api/provisioning"];

function coincide(pathname, prefijos) {
  return prefijos.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"));
}

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

  // Reparto por host. VA LO PRIMERO, antes incluso de los preflights: si fuera
  // después, un OPTIONS o la rama del widget (que retornan antes) se saltarían
  // el reparto y el subdominio interno seguiría sirviéndolos.
  if (ADMIN_HOST) {
    if (esPeticionDeBackoffice(request)) {
      // La raíz del subdominio lleva al panel, no al escritorio del CRM. Sin
      // esto, entrar por "admin.salamandrasolutions.com" a secas dejaba a la
      // cuenta del panel mirando los clientes y la facturación de Salamandra,
      // y sin ningún enlace para llegar a lo que venía a hacer.
      if (pathname === "/") {
        return NextResponse.redirect(new URL("/admin", request.url));
      }
      // Lista BLANCA: aquí solo existe el back-office (ver la nota de
      // SOLO_ESTO_EN_BACKOFFICE). Lo que no esté, no está.
      if (!coincide(pathname, SOLO_ESTO_EN_BACKOFFICE)) {
        return new NextResponse(null, { status: 404 });
      }
    } else if (coincide(pathname, SOLO_BACKOFFICE)) {
      return new NextResponse(null, { status: 404 });
    }
  } else if (coincide(pathname, SOLO_BACKOFFICE)) {
    // Sin ADMIN_HOST configurado, el back-office no se sirve en NINGÚN sitio.
    // Falla en cerrado: una variable ausente nunca debe abrir una puerta.
    return new NextResponse(null, { status: 404 });
  }

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

    // ── ¿Nació esta sesión en este host? ────────────────────────────────────
    // El back-office y el CRM son la MISMA app, en el mismo contenedor, con el
    // MISMO secreto de firma. Sin esta comprobación, un `access_token` obtenido
    // en el CRM vale tal cual en el panel: basta copiar la cookie con curl. Que
    // se ponga sin `domain` solo impide que la mande sola un NAVEGADOR; a quien
    // usa curl no le impide nada, y quien tiene la contraseña es exactamente la
    // amenaza de la que este panel se defiende.
    //
    // Por eso el token va SELLADO con dónde se emitió (`bo`) y aquí se exige que
    // coincida, en las dos direcciones. Comprobarlo en el middleware y no en
    // cada endpoint es lo que hace que no haya que acordarse mañana, al añadir
    // la siguiente ruta.
    //
    // Los tokens de antes de este cambio no llevan `bo`: cuentan como del CRM,
    // así que las sesiones abiertas siguen valiendo ahí y solo hay que volver a
    // entrar en el panel.
    const sesionDeBackoffice = payload.payload.bo === true;
    if (sesionDeBackoffice !== esPeticionDeBackoffice(request)) {
      if (isApiPath(pathname)) {
        return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
      }
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
      const res = NextResponse.redirect(loginUrl);
      // Se limpia la cookie: si no, quedaría rebotando contra el login con una
      // sesión que en este host no vale para nada.
      res.cookies.set("access_token", "", { maxAge: 0, path: "/" });
      return res;
    }

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
