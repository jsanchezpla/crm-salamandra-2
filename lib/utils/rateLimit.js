import { NextResponse } from "next/server";

/**
 * Rate limit in-memory por IP para endpoints públicos sin JWT.
 *
 * Implementación: token bucket por (clave + IP). Cada bucket se rellena
 * completo al inicio de su ventana — sin reposición continua. Es suficiente
 * para frenar spam scriptado en el contenedor Next.js de producción (un
 * único proceso, un único Docker). Si en el futuro escalamos a >1 instancia
 * habrá que migrar este store a Redis o a una cookie/CDN externa.
 *
 * El estado vive en memoria; se pierde al reiniciar el contenedor. No es un
 * problema por construcción: un atacante que fuerce reinicios se enfrenta a
 * otros límites (deploy gate, monitorización).
 *
 * Para una request entrante, llama a `enforceRateLimit(request, opts)`. Si
 * devuelve un NextResponse, devuélvelo desde el handler; si devuelve `null`,
 * continúa el flujo normal.
 *
 * Endpoints aplicados (junio 2026): todos los `/api/public/*`. Pendientes
 * de revisar con políticas específicas: `/api/auth/login` (brute force con
 * ventanas más cortas), `/api/cursos-empresas/*` (vector de enumeración
 * documentado en TC-062), `/api/register` y `/api/usuarios/register/*`
 * (alta de cuentas — requiere límite más bajo).
 */

const buckets = new Map();
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function sweepExpired(now) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Extrae la IP cliente. Detrás del nginx del VPS el cliente real está en
 * `X-Forwarded-For` (el primer valor de la lista). Fallback a `X-Real-IP`
 * (algunos despliegues lo usan) y por último a `unknown` — agrupando todas
 * las IPs no identificables bajo una sola key, lo que es deliberado: si el
 * proxy no inyecta cabeceras, mejor sobre-limitar que dejar el endpoint
 * abierto.
 */
export function getClientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/**
 * Comprueba el bucket y consume un token si hay. No produce respuesta;
 * pensado para tests o llamadas avanzadas.
 *
 * @returns {{ allowed: boolean, retryAfter: number, ip: string, remaining: number }}
 */
export function checkRateLimit(request, { key = "default", limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  sweepExpired(now);
  const ip = getClientIp(request);
  const bucketKey = `${key}:${ip}`;
  let bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { tokens: limit, resetAt: now + windowMs };
    buckets.set(bucketKey, bucket);
  }
  if (bucket.tokens <= 0) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return { allowed: false, retryAfter, ip, remaining: 0 };
  }
  bucket.tokens -= 1;
  return { allowed: true, retryAfter: 0, ip, remaining: bucket.tokens };
}

/**
 * Helper para Route Handlers. Devuelve un NextResponse 429 si la IP supera
 * el límite, o `null` para continuar. Loguea en consola cada vez que se
 * bloquea una request, con la IP y la clave del bucket — útil para detectar
 * abusos en producción sin necesitar instrumentación extra.
 */
export function enforceRateLimit(request, opts) {
  const result = checkRateLimit(request, opts);
  if (result.allowed) return null;
  const key = opts?.key ?? "default";
  console.warn(`[rate-limit] BLOQUEADO ip=${result.ip} key=${key} retry_after=${result.retryAfter}s`);
  return NextResponse.json(
    {
      ok: false,
      error: `Demasiadas solicitudes. Inténtalo en ${result.retryAfter}s.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfter),
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * Solo expuesto para tests. NO usar en producción.
 */
export function _resetRateLimitState() {
  buckets.clear();
  lastSweep = 0;
}
