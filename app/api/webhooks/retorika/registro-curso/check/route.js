import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../../../lib/tenant/tenantResolver.js";
import { handleRouteError } from "../../../../../../lib/utils/errors.js";
import { verifyWebhookSignature } from "../../../../../../lib/training/webhookAuth.js";
import { enforceRateLimit } from "../../../../../../lib/utils/rateLimit.js";

/**
 * GET /api/webhooks/retorika/registro-curso/check?email=&productId=
 *
 * Lo llama el snippet PHP en WP de Retorika al cargar el curso TutorLMS:
 * si NO existe registro previo, el PHP redirige al formulario público.
 *
 * Autenticación: HMAC SHA256 con header `X-Retorika-Signature`. La firma
 * se calcula sobre la QUERY STRING `"email=<v>&productId=<v>"` (los
 * mismos pares que vienen en la URL, mismo orden, urlencoded igual que
 * el snippet PHP).
 *
 * Rate limit: 60 req/min por IP. Mismo bucket que otros endpoints
 * Retorika.
 *
 * Logging: `[retorika:check] email=*** productId=N has=bool`.
 */
export async function GET(request) {
  try {
    // ── Rate limit ─────────────────────────────────────────────────────
    const limited = enforceRateLimit(request, {
      key: "retorika-registro-check",
      limit: 60,
      windowMs: 60_000,
    });
    if (limited) return limited;

    // ── HMAC sobre la query string ─────────────────────────────────────
    const url = new URL(request.url);
    const query = url.searchParams.toString(); // "email=...&productId=..."
    const signature = request.headers.get("x-retorika-signature");

    if (!(await verifyWebhookSignature(query, signature, request))) {
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
    }

    // ── Params ─────────────────────────────────────────────────────────
    const email = (url.searchParams.get("email") || "").trim().toLowerCase();
    const productIdRaw = url.searchParams.get("productId");
    if (!email) return NextResponse.json({ ok: false, error: "email obligatorio" }, { status: 400 });
    const productId = Number.parseInt(productIdRaw, 10);
    if (!Number.isFinite(productId) || productId <= 0) {
      return NextResponse.json({ ok: false, error: "productId inválido" }, { status: 400 });
    }

    // ── Resolver tenant + check módulo ─────────────────────────────────
    const ctx = await getTenantContext(request);
    if (!ctx.hasModule("training")) {
      return NextResponse.json({ ok: false, error: "Módulo training no activo" }, { status: 403 });
    }

    // ── COUNT optimizado (índice compuesto email + wp_product_id) ──────
    const { CourseRegistration } = ctx.tenantModels;
    const count = await CourseRegistration.count({
      where: { email, wpProductId: productId },
    });
    const has = count > 0;

    // Email enmascarado para logs (no PII en stdout):
    const maskedEmail = email.replace(/(.{2}).*(@.*)/, "$1***$2");
    process.stdout.write(`[retorika:check] email=${maskedEmail} productId=${productId} has=${has}\n`);

    return NextResponse.json({ ok: true, has });
  } catch (err) {
    return handleRouteError(err);
  }
}
