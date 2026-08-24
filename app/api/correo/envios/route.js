import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { AppError, ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { assertNotDemoPaidCall } from "../../../../lib/demo/isDemo.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { sendEmail } from "../../../../lib/email/resendClient.js";
import { getTenantResendConfig } from "../../../../lib/outreach/resendConfig.js";
import { esEmail, formatearFrom, resolverRemitente } from "../../../../lib/email/remitentes.js";

/**
 * POST /api/correo/envios — mandar UN mensaje a VARIOS destinatarios.
 *
 * Lo pidió Rodrigo el 24/08/2026: «poder unir la cantidad de correos que quiera
 * y elegir con qué correo quiero mandar el mensaje».
 *
 * ── UNO A UNO, NO UN «PARA» CON CIEN DIRECCIONES ───────────────────────────
 * Se manda un correo POR destinatario, aunque cueste más. Meterlos a todos en
 * el mismo `to` enseñaría a cada ayuntamiento la lista entera de los demás
 * —los competidores incluidos— y es, además, un problema de protección de
 * datos. Con copia oculta tampoco: un correo con 80 en oculto va a spam mucho
 * antes que 80 correos normales, y aquí lo que se juega es que la propuesta se
 * lea.
 *
 * ── NUNCA REVIENTA A MEDIAS ────────────────────────────────────────────────
 * Un fallo en el destinatario 12 no puede tirar los 40 restantes ni dejar a
 * quien envía sin saber cuáles salieron. Se envían todos, se recoge el
 * resultado de cada uno y se devuelve el desglose. La pantalla enseña
 * «38 enviados, 2 fallaron» con nombre y apellidos de los dos.
 *
 * ── EL DRY-RUN NO MIENTE ───────────────────────────────────────────────────
 * `sendEmail` devuelve `{ok:true, dryRun:true}` cuando no hay clave de Resend,
 * y eso ya hizo que una pantalla dijera «enviado» con el buzón vacío (ver el
 * comentario de `lib/email/resendClient.js`). Aquí el dry-run se responde como
 * lo que es: `simulados`, en su propio contador, nunca como enviados.
 */

const MAX_DESTINATARIOS = 200;
const MAX_ASUNTO = 200;
const MAX_CUERPO = 20000;

export const POST = withTenant(async (request, _ctxRuta, ctx) => {
  // Escribir a gente exige tener a quién: sin Clientes ni Captación no hay
  // agenda que valga y esta pantalla no existe.
  if (!ctx.hasModule("clients") && !ctx.hasModule("outreach")) throw new ForbiddenError();

  // La demo pública da sesión de admin a cualquiera y el destinatario, asunto y
  // cuerpo vienen en el body: con una clave de Resend puesta, esto sería un
  // relé de spam abierto. Mismo guard que el envío de Captación.
  assertNotDemoPaidCall(ctx, "El envío de correos");

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const asunto = String(body?.asunto ?? "").trim();
  const cuerpo = String(body?.cuerpo ?? "").trim();
  const remitenteId = body?.remitenteId ?? null;

  if (!asunto) throw new ValidationError("El asunto no puede quedar vacío");
  if (asunto.length > MAX_ASUNTO) throw new ValidationError(`El asunto no puede pasar de ${MAX_ASUNTO} caracteres`);
  if (!cuerpo) throw new ValidationError("El mensaje no puede quedar vacío");
  if (cuerpo.length > MAX_CUERPO) throw new ValidationError("El mensaje es demasiado largo");

  // ── Destinatarios: limpiar antes de mirar nada más ────────────────────────
  if (!Array.isArray(body?.destinatarios)) throw new ValidationError("«destinatarios» tiene que ser una lista");

  const vistos = new Set();
  const validos = [];
  const invalidos = [];
  for (const bruto of body.destinatarios) {
    const email = String(typeof bruto === "string" ? bruto : (bruto?.email ?? "")).trim().toLowerCase();
    if (!esEmail(email)) {
      if (email) invalidos.push(email);
      continue;
    }
    if (vistos.has(email)) continue;
    vistos.add(email);
    validos.push({ email, nombre: typeof bruto === "object" ? (bruto?.nombre ?? null) : null });
  }

  if (!validos.length) throw new ValidationError("No hay ni un destinatario válido al que escribir");
  if (validos.length > MAX_DESTINATARIOS) {
    throw new ValidationError(
      `Son ${validos.length} destinatarios y el tope por envío es ${MAX_DESTINATARIOS}. Pártelo en varias tandas.`
    );
  }

  // ── Remitente: el elegido, y si no está, se para ──────────────────────────
  const remitente = resolverRemitente(ctx, remitenteId);
  if (!remitente) {
    throw new ValidationError(
      remitenteId
        ? "Ese remitente ya no existe. Elige otro en Configuración → Conexiones."
        : "No hay ningún remitente configurado. Añade uno en Configuración → Conexiones."
    );
  }

  const { apiKey } = getTenantResendConfig(ctx);
  if (!apiKey) {
    throw new AppError(
      "Configura la clave de Resend en Configuración antes de enviar correos.",
      400
    );
  }

  // ── Envío, uno a uno ──────────────────────────────────────────────────────
  const enviados = [];
  const simulados = [];
  const fallidos = [];

  for (const d of validos) {
    let r;
    try {
      r = await sendEmail({
        to: d.email,
        subject: asunto,
        text: cuerpo,
        from: formatearFrom(remitente) || undefined,
        replyTo: remitente.replyTo || undefined,
        apiKey,
        tags: [{ name: "module", value: "correo" }],
      });
    } catch (err) {
      // `sendEmail` promete no propagar, pero si algún día lo hace, un envío
      // masivo a medias no puede quedarse sin contar.
      r = { ok: false, error: err?.message || "error inesperado" };
    }

    if (!r.ok) fallidos.push({ email: d.email, nombre: d.nombre, motivo: r.error || "desconocido" });
    else if (r.dryRun) simulados.push({ email: d.email, nombre: d.nombre });
    else enviados.push({ email: d.email, nombre: d.nombre, id: r.id ?? null });
  }

  // Auditoría: quién escribió, desde qué dirección, a cuántos. NO se guarda el
  // cuerpo — puede llevar datos de la persona y el registro de auditoría se
  // consulta para otra cosa. El asunto sí: es lo que permite reconocer el envío.
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId: ctx.tenant.id,
      userId: ctx.user?.id ?? null,
      action: "correo.envio_masivo",
      entity: "correo",
      entityId: null,
      before: null,
      after: {
        remitente: remitente.email,
        asunto,
        total: validos.length,
        enviados: enviados.length,
        simulados: simulados.length,
        fallidos: fallidos.length,
      },
    });
  } catch {
    // La auditoría nunca rompe un envío que ya ha salido.
  }

  return ok({
    remitente: { email: remitente.email, nombre: remitente.nombre },
    total: validos.length,
    enviados,
    simulados,
    fallidos,
    // Direcciones que venían mal escritas y ni se intentaron. Se devuelven para
    // que quien envía pueda corregirlas, no se tiran en silencio.
    invalidos,
    dryRun: simulados.length > 0 && enviados.length === 0,
  });
});
