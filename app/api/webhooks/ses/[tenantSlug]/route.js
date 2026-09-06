import { NextResponse } from "next/server";
import { withPublicTenant } from "../../../../../lib/tenant/publicTenantContext.js";
import { firmaSnsValida } from "../../../../../lib/mailing/snsFirma.js";
import { procesarAvisoSes } from "../../../../../lib/mailing/avisosSes.js";

/**
 * /api/webhooks/ses/[tenantSlug] — los rebotes y las quejas que manda AWS.
 *
 * ── CÓMO LLEGA ───────────────────────────────────────────────────────────────
 * SES no llama a webhooks: publica en un tema de SNS y SNS entrega por HTTPS.
 * Al dar de alta la suscripción, SNS manda primero un `SubscriptionConfirmation`
 * con una URL que hay que visitar; después, cada aviso es un `Notification`
 * cuyo `Message` es el JSON del evento de SES. Los dos llegan con
 * `Content-Type: text/plain` (sí, con JSON dentro) y firmados con la clave de
 * Amazon: la firma se comprueba SIEMPRE (lib/mailing/snsFirma.js) antes de
 * tocar nada. Sin ella, cualquiera que adivinara la URL podría vaciar la lista
 * de un cliente a base de «quejas» falsas.
 *
 * ── POR QUÉ EL TENANT VA EN LA URL ───────────────────────────────────────────
 * Cada cliente tiene su cuenta de AWS y su tema de SNS, y suscribe la URL con
 * su slug: el destino lo fija nuestra configuración, no el contenido del
 * aviso. Mismo criterio que los webhooks de WhatsApp y Stripe.
 *
 * ── QUÉ SE RESPONDE ──────────────────────────────────────────────────────────
 *   · firma inválida → 403 y no se procesa nada.
 *   · tipo desconocido → 200 (un 4xx pondría a SNS a reintentar durante días).
 *   · error de base → 500, para que SNS reintente.
 *
 * Sin guard de demo: no manda correo, no gasta IA y no escribe en master; y
 * para llegar hace falta la firma de Amazon.
 */
export const POST = withPublicTenant(
  async (request, _rc, ctx) => {
    if (!ctx.hasModule("mailing")) return NextResponse.json({ ok: false, error: "Módulo no disponible" }, { status: 404 });

    const crudo = await request.text();
    let mensaje;
    try {
      mensaje = JSON.parse(crudo);
    } catch {
      return NextResponse.json({ ok: true, ignored: "no es JSON" });
    }

    const firma = await firmaSnsValida(mensaje);
    if (!firma.ok) {
      process.stderr.write(`[mailing:ses-webhook] ${ctx.slug}: firma inválida (${firma.motivo})\n`);
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 403 });
    }

    if (mensaje.Type === "SubscriptionConfirmation") {
      // Confirmar la suscripción visitando la URL que manda SNS, solo si es de Amazon.
      let confirmada = false;
      try {
        const u = new URL(mensaje.SubscribeURL);
        if (u.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(u.hostname)) {
          const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
          confirmada = res.ok;
        }
      } catch {
        confirmada = false;
      }
      process.stdout.write(`[mailing:ses-webhook] ${ctx.slug}: suscripción ${confirmada ? "confirmada" : "NO confirmada"} (${mensaje.TopicArn})\n`);
      return NextResponse.json({ ok: true, confirmada });
    }

    if (mensaje.Type !== "Notification") return NextResponse.json({ ok: true, ignored: mensaje.Type });

    let evento;
    try {
      evento = JSON.parse(mensaje.Message);
    } catch {
      return NextResponse.json({ ok: true, ignored: "Message no es JSON" });
    }

    try {
      const r = await procesarAvisoSes(ctx, evento);
      return NextResponse.json({ ok: true, ...r });
    } catch (err) {
      process.stderr.write(`[mailing:ses-webhook] ${ctx.slug}: error ${err.message}\n`);
      return NextResponse.json({ ok: false, error: "Error procesando el aviso" }, { status: 500 });
    }
  },
  { rateLimit: { limit: 600, windowMs: 60_000, key: "ses-webhook" } }
);
