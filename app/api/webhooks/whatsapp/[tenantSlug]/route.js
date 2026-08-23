import { NextResponse } from "next/server";
import { withPublicTenant } from "../../../../../lib/tenant/publicTenantContext.js";
import { firmaValida, tokenAltaValido, webhookConfigurado } from "../../../../../lib/whatsapp/webhookAuth.js";
import { guardarEstado, guardarMensaje, mensajesDelHistorial, soloDigitos } from "../../../../../lib/whatsapp/inbox.js";

/**
 * /api/webhooks/whatsapp/[tenantSlug] — lo que WhatsApp nos manda.
 *
 * ── POR QUÉ EL TENANT VA EN LA URL ───────────────────────────────────────────
 * Siendo Tech Provider, todas las cuentas de WhatsApp de nuestros clientes
 * cuelgan de UNA app de Meta, así que por defecto sus mensajes llegarían todos
 * a la misma URL. Meta permite fijar una URL alternativa por cuenta
 * (`override_callback_uri`), y eso es lo que usamos: cada cliente tiene la
 * suya, con su slug en la ruta.
 *
 * No es cosmético. Sin eso habría que deducir de quién es cada mensaje mirando
 * el `phone_number_id` del payload y cruzándolo contra la configuración de
 * todos los clientes — o sea, decidir a qué schema se escribe a partir de un
 * dato que viene de fuera. Con el slug en la ruta, el destino lo fija nuestra
 * configuración en Meta, no el contenido de la petición. Mismo criterio que el
 * webhook de Stripe, y por el mismo susto: el 2026-07-26 se corrigió aquí una
 * suplantación cross-tenant en los webhooks de TutorLMS, porque el tenant
 * destino viajaba en una cabecera que controlaba quien llamaba.
 *
 * ── SIN GUARD DE DEMO ────────────────────────────────────────────────────────
 * Este endpoint no manda correo, no gasta IA y no escribe en master: solo
 * escribe en el schema del cliente, y para llegar hace falta la firma con
 * nuestro App Secret. Un visitante anónimo de la demo no puede alcanzarlo.
 */

/**
 * GET — el apretón de manos del alta.
 *
 * Meta llama UNA vez al dar de alta la URL, con `hub.verify_token`, y espera
 * que le devolvamos su `hub.challenge` **en texto plano y a secas**. Nada de
 * envolverlo en JSON: si respondemos `{"challenge":"123"}` Meta lo da por malo
 * y la URL no se verifica.
 */
export const GET = withPublicTenant(
  async (request, _ctx, tenantContext) => {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !tokenAltaValido(tenantContext.slug, token)) {
      // 403 a secas: ni se confirma que el cliente exista ni por qué falla.
      return new NextResponse("Forbidden", { status: 403 });
    }
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
  { rateLimit: { limit: 20, windowMs: 60_000, key: "whatsapp-webhook-verify" } }
);

/**
 * POST — mensajes, acuses de entrega e historial.
 *
 * Qué se responde y por qué:
 *   · firma inválida            → 401. No se procesa nada a ciegas.
 *   · lo que no entendemos      → 200. Un 4xx pondría a Meta a reintentar
 *                                 durante días eventos que nunca vamos a querer.
 *   · falló TODO lo que llegó   → 500, para que Meta reintente. Es la forma de
 *                                 no perder mensajes si la base está caída; un
 *                                 fallo suelto entre varios no lo dispara.
 */
export const POST = withPublicTenant(
  async (request, _ctx, tenantContext) => {
    const { slug } = tenantContext;

    if (!webhookConfigurado()) {
      // Sin secretos no se puede verificar nada. 503 y no se toca la base.
      return NextResponse.json({ ok: false, error: "Webhook de WhatsApp no configurado" }, { status: 503 });
    }

    // Cuerpo CRUDO: la firma se calcula sobre los bytes exactos.
    const rawBody = await request.text();
    if (!firmaValida(rawBody, request.headers.get("x-hub-signature-256"))) {
      process.stderr.write(`[whatsapp:webhook] ${slug}: firma inválida\n`);
      return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: true, ignored: "payload no JSON" });
    }

    const cuenta = { guardados: 0, duplicados: 0, estados: 0, historial: 0, errores: 0 };
    const anota = (r) => {
      if (r === "guardado") cuenta.guardados++;
      else if (r === "duplicado") cuenta.duplicados++;
      else if (r === "error") cuenta.errores++;
    };

    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        // El número del NEGOCIO, para saber de qué lado va cada mensaje.
        const propio = soloDigitos(value?.metadata?.display_phone_number);

        // 1) Lo que escribe el paciente.
        for (const m of value.messages ?? []) {
          anota(await guardarMensaje(tenantContext, {
            mensaje: m,
            direction: "in",
            origin: "app",
            telefono: m.from,
          }));
        }

        // 2) Coexistencia: lo que el cliente manda DESDE SU MÓVIL. Meta nos
        //    hace eco para que el hilo del CRM no tenga agujeros. Se comprueba
        //    aquí y no por el nombre del campo porque Meta los entrega unas
        //    veces en `message_echoes` y otras dentro del propio `messages`.
        for (const m of value.message_echoes ?? []) {
          anota(await guardarMensaje(tenantContext, {
            mensaje: m,
            direction: "out",
            origin: "app",
            telefono: m.to ?? m.recipient_id,
          }));
        }

        // 3) Acuses de entrega de lo que mandó el CRM.
        for (const s of value.statuses ?? []) {
          const r = await guardarEstado(tenantContext, s);
          if (r === "error") cuenta.errores++;
          else cuenta.estados++;
        }

        // 4) Los 180 días de historial que llegan al conectar la coexistencia.
        for (const { mensaje, hilo } of mensajesDelHistorial(value)) {
          const de = soloDigitos(mensaje?.from);
          const saliente = !!propio && de === propio;
          // Un mensaje SALIENTE del historial no siempre dice a quién iba: en
          // un hilo de dos, el que lo mandó es el centro y el destinatario se
          // da por sobreentendido. Meta identifica cada hilo por el wa_id del
          // contacto, así que ese es el respaldo — pero solo si de verdad
          // parece un teléfono, porque un identificador opaco metido en la
          // columna `phone` sería peor que dejarla vacía.
          //
          // Sin esto la fila se guardaba con el teléfono en blanco y sin ficha:
          // el mensaje no se perdía, pero desaparecía del hilo del paciente, que
          // es el único sitio donde alguien lo va a buscar.
          const delHilo = soloDigitos(hilo).length >= 9 ? hilo : null;
          const r = await guardarMensaje(tenantContext, {
            mensaje,
            direction: saliente ? "out" : "in",
            origin: "history",
            telefono: saliente ? (mensaje?.to ?? mensaje?.recipient_id ?? delHilo) : mensaje?.from,
          });
          if (r === "error") cuenta.errores++;
          else cuenta.historial++;
        }

        // Lo que no reconocemos deja rastro con su forma, para poder ajustarlo
        // con un caso real delante en vez de adivinando.
        if (
          !value.messages && !value.statuses && !value.message_echoes && !value.history
        ) {
          process.stderr.write(
            `[whatsapp:webhook] ${slug}: campo sin tratar "${change?.field}" — claves: ${Object.keys(value).join(", ")}\n`
          );
        }
      }
    }

    const tocados = cuenta.guardados + cuenta.duplicados + cuenta.estados + cuenta.historial;
    if (cuenta.errores > 0 && tocados === 0) {
      // Nada entró y todo falló: huele a base caída. 500 para que Meta
      // reintente en vez de dar por buenos unos mensajes que se han perdido.
      process.stderr.write(`[whatsapp:webhook] ${slug}: ${cuenta.errores} fallos y 0 aciertos — se pide reintento\n`);
      return NextResponse.json({ ok: false, error: "Error procesando el evento" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ...cuenta });
  },
  // Meta entrega en ráfagas (el historial llega troceado en muchas llamadas);
  // un límite bajo tiraría eventos legítimos. La firma es la barrera real.
  { rateLimit: { limit: 300, windowMs: 60_000, key: "whatsapp-webhook" } }
);
