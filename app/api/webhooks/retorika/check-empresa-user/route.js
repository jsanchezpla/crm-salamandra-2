import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../lib/utils/errors.js";
import { enforceRateLimit } from "../../../../../lib/utils/rateLimit.js";

/**
 * POST /api/webhooks/retorika/check-empresa-user
 *
 * Lo llama el shortcode `[retorika_registro]` de WP de Retorika ANTES de
 * crear el usuario por la vía privada. Si el alumno ya existe en el CRM
 * como TrainingUser de tipo empresa con `active=false` (importado pero
 * sin activar todavía), el WP debe redirigirle al form de registro
 * empresa en lugar de crearle por la vía privada.
 *
 * Auth: modo BROWSER (mismo patrón que POST /registro-curso, sin HMAC).
 *   - header `x-tenant: retorika`
 *   - Origin/Referer en {asesoriaretorika.com, www.asesoriaretorika.com}
 *   - rate limit 30/min por IP
 *
 * Sin HMAC: este endpoint sirve a un form HTML público (el secret no
 * puede vivir en JS del navegador). La privacidad de la respuesta se
 * cuida en el cuerpo: solo se devuelve un booleano, ningún dato del
 * TrainingUser (nombre, empresa, NIF…). Un atacante con la URL solo
 * puede comprobar "este email es empresa inactiva?" — el mismo bit que
 * obtendría intentando el registro privado.
 *
 * Body JSON: { email: "alumno@dominio.com" }
 * Respuesta 200: { ok: true, isEmpresaInactive: boolean }
 *
 * Lógica:
 *   - TrainingUser no existe                              → false
 *   - existe AND type='company' AND active=false          → true
 *   - cualquier otro caso (privado, empresa activo, etc.) → false
 *
 * Logging: `[retorika:check-empresa-user] email_masked=... result=...`
 * — el email se enmascara para no inyectar PII en stdout.
 */
const ALLOWED_HOSTS = new Set(["asesoriaretorika.com", "www.asesoriaretorika.com"]);

function originAllowed(request) {
  const candidates = [request.headers.get("origin"), request.headers.get("referer")]
    .filter(Boolean)
    .map((u) => { try { return new URL(u).hostname; } catch { return null; } })
    .filter(Boolean);
  if (candidates.length === 0) return false;
  return candidates.some((h) => ALLOWED_HOSTS.has(h));
}

function maskEmail(email) {
  const at = email.indexOf("@");
  if (at < 0) return "***";
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainPart = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${user.slice(0, 3)}***@${domainPart.slice(0, 4)}***${tld}`;
}

export async function POST(request) {
  try {
    // ── Auth modo browser ──────────────────────────────────────────────
    const tenantHeader = request.headers.get("x-tenant");
    if (tenantHeader !== "retorika") {
      return NextResponse.json({ ok: false, error: "Acceso denegado" }, { status: 401 });
    }
    if (!originAllowed(request)) {
      return NextResponse.json({ ok: false, error: "Origen no autorizado" }, { status: 401 });
    }

    // ── Rate limit ─────────────────────────────────────────────────────
    const limited = enforceRateLimit(request, {
      key: "retorika-check-empresa-user",
      limit: 30,
      windowMs: 60_000,
    });
    if (limited) return limited;

    // ── Body ───────────────────────────────────────────────────────────
    let payload;
    try { payload = await request.json(); }
    catch { return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 }); }

    const rawEmail = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return NextResponse.json({ ok: false, error: "email inválido" }, { status: 400 });
    }

    // ── Resolver tenant + check módulo ─────────────────────────────────
    const ctx = await getTenantContext(request);
    if (!ctx.hasModule("training")) {
      return NextResponse.json({ ok: false, error: "Módulo training no activo" }, { status: 403 });
    }

    const { TrainingUser } = ctx.tenantModels;

    // ── Lookup: la conversión a lowercase ya se hace en beforeSave del
    //    modelo y el índice unique sobre email, pero el hook solo aplica
    //    en INSERT/UPDATE. Para la búsqueda comparamos sobre el email ya
    //    normalizado en el endpoint (`rawEmail`).
    const user = await TrainingUser.findOne({
      where: { email: rawEmail },
      attributes: ["id", "type", "active"],
    });

    const isEmpresaInactive = !!(user && user.type === "company" && user.active === false);

    process.stdout.write(
      `[retorika:check-empresa-user] email_masked=${maskEmail(rawEmail)} result=${isEmpresaInactive}\n`
    );

    return NextResponse.json({ ok: true, isEmpresaInactive });
  } catch (err) {
    return handleRouteError(err);
  }
}
